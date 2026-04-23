// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { IotaClient } from '@iota/iota-sdk/client';
import { createHash } from 'node:crypto';

import {
  MSG_COMMIT,
  MSG_REVEAL,
  MSG_PARTIAL,
  MSG_NO_COMMIT,
  type OracleMessage,
  readOracleMessages,
} from '../oracleMessages';
import { sleep } from '../utils/sleep';

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex').toLowerCase();
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').toLowerCase();
}



export async function waitForCommitQuorum(opts: {
  client: IotaClient; taskId: string; round: number; assignedNodes: string[]; quorumK: number; waitMs: number; pollMs: number; minTimestampMs?: number;
}) {
  const until = Date.now() + opts.waitMs;
  const assigned = new Set(opts.assignedNodes.map((x) => x.toLowerCase()));
  while (Date.now() < until) {
    const msgs = await readOracleMessages(opts.client, opts.taskId, opts.round, { minTimestampMs: opts.minTimestampMs });
    const commits = msgs.filter((m) => m.kind === MSG_COMMIT && assigned.has(m.sender));
    const bySender = new Map<string, OracleMessage>();
    for (const m of commits) if (!bySender.has(m.sender)) bySender.set(m.sender, m);
    if (bySender.size >= opts.quorumK) return { ok: true, commits: bySender };

    const noCommitMsgs = msgs.filter((m) => m.kind === MSG_NO_COMMIT && assigned.has(m.sender));
    const noCommitBySender = new Map<string, OracleMessage>();
    for (const m of noCommitMsgs) if (!noCommitBySender.has(m.sender)) noCommitBySender.set(m.sender, m);

    const noCommitCount = noCommitBySender.size;
    const maxPossibleCommits = assigned.size - noCommitCount;
    if (maxPossibleCommits < opts.quorumK) {
      return {
        ok: false as const,
        reason: 'no_quorum' as const,
        commits: bySender,
        noCommitCount,
        maxPossibleCommits,
        noCommits: noCommitBySender,
      };
    }

    await sleep(opts.pollMs);
  }
  return { ok: false as const, reason: 'commit_timeout' as const };
}

export async function waitForRevealResolution(opts: {
  client: IotaClient; taskId: string; round: number; assignedNodes: string[]; quorumK: number; waitMs: number; pollMs: number; minTimestampMs?: number; extraCollectMs?: number;
}) {
  const until = Date.now() + opts.waitMs;
  const assigned = new Set(opts.assignedNodes.map((x) => x.toLowerCase()));
  let quorumReachedAt = 0;
  while (Date.now() < until) {
    const msgs = await readOracleMessages(opts.client, opts.taskId, opts.round, { minTimestampMs: opts.minTimestampMs });
    const reveals = msgs.filter((m) => m.kind === MSG_REVEAL && assigned.has(m.sender));
    const bySender = new Map<string, OracleMessage>();
    for (const m of reveals) if (!bySender.has(m.sender)) bySender.set(m.sender, m);

    const groups = new Map<string, { hash: string; messages: OracleMessage[] }>();
    for (const m of bySender.values()) {
      const h = sha256Hex(m.payload);
      const g = groups.get(h) ?? { hash: h, messages: [] };
      g.messages.push(m);
      groups.set(h, g);
    }
    let winner: { hash: string; messages: OracleMessage[] } | null = null;
    for (const g of groups.values()) {
      if (!winner || g.messages.length > winner.messages.length) winner = g;
    }
    if (winner && winner.messages.length >= opts.quorumK) {
      if (!quorumReachedAt) quorumReachedAt = Date.now();
      const extraCollectMs = Math.max(0, opts.extraCollectMs ?? 0);
      if (winner.messages.length >= assigned.size || Date.now() >= quorumReachedAt + extraCollectMs) {
        return { ok: true, resultHashHex: winner.hash, reveals: bySender, supporters: winner.messages.map((m) => m.sender), winnerPayload: winner.messages[0].payload };
      }
    }
    if (bySender.size >= assigned.size) {
      return { ok: false, reason: 'no_quorum' as const, reveals: bySender };
    }
    await sleep(opts.pollMs);
  }
  return { ok: false, reason: 'reveal_timeout' as const };
}

export async function waitForPartialQuorum(opts: {
  client: IotaClient; taskId: string; round: number; signerAddrs: string[]; quorumK: number; messageDigestHex: string; waitMs: number; pollMs: number; minTimestampMs?: number; extraCollectMs?: number;
}) {
  const until = Date.now() + opts.waitMs;
  const allowed = new Set(opts.signerAddrs.map((x) => x.toLowerCase()));
  let quorumReachedAt = 0;
  while (Date.now() < until) {
    const msgs = await readOracleMessages(opts.client, opts.taskId, opts.round, { minTimestampMs: opts.minTimestampMs });
    const partials = msgs.filter((m) => m.kind === MSG_PARTIAL && allowed.has(m.sender));
    const bySender = new Map<string, OracleMessage>();
    for (const m of partials) {
      const digestHex = hex(m.signature);
      if (digestHex !== opts.messageDigestHex) continue;
      if (!bySender.has(m.sender)) bySender.set(m.sender, m);
    }
    if (bySender.size >= opts.quorumK) {
      if (!quorumReachedAt) quorumReachedAt = Date.now();
      const extraCollectMs = Math.max(0, opts.extraCollectMs ?? 0);
      if (bySender.size >= allowed.size || Date.now() >= quorumReachedAt + extraCollectMs) {
        return { ok: true, partials: bySender };
      }
    }
    await sleep(opts.pollMs);
  }
  return { ok: false, reason: 'partial_timeout' as const };
}

export function buildCertificateBlob(parts: { kind: string; signers: string[]; resultHashHex?: string; reasonCode?: number; round: number }) {
  return new TextEncoder().encode(JSON.stringify(parts));
}
