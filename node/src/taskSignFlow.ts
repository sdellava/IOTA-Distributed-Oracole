// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

// src/taskSignFlow.ts
// On-chain commit/reveal/sign flow aligned with the current oracle_tasks module split
// across oracle_tasks, oracle_task_config, oracle_task_runtime, oracle_task_store.

import type { IotaClient, IotaObjectResponse } from "@iota/iota-sdk/client";
import { Transaction } from "@iota/iota-sdk/transactions";
import type { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { createHash } from "node:crypto";

import { decodeVecU8 } from "./events";
import { bcsAddress, bcsU8, bcsU64, bcsVecU8 } from "./bcs";
import { assertCommitteeMultisigAddress, buildMultiSigPublicKey } from "./multisig";
import { optInt } from "./nodeConfig";
import { loadTaskBundle } from "./services/taskObjects";
import { signAndExecuteWithLockRetry } from "./txRetry.js";
import { getClockId as getConfiguredClockId, getTasksPackageId as getConfiguredTasksPackageId } from "./config/env.js";

function getTasksPackageId(): string {
  return getConfiguredTasksPackageId();
}

function getClockId(): string {
  return getConfiguredClockId();
}

function envIntAlias(primary: string, fallback: string, def: number): number {
  const raw = process.env[primary]?.trim() || process.env[fallback]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${primary}/${fallback}: ${raw}`);
  return Math.floor(n);
}

function envBool(name: string, def = false): boolean {
  const v = process.env[name]?.trim();
  if (!v) return def;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes";
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(bytes).digest());
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function getMoveFields(resp: IotaObjectResponse): Record<string, any> | null {
  const c: any = resp.data?.content;
  if (!c || c.dataType !== "moveObject") return null;
  return (c.fields ?? null) as Record<string, any> | null;
}

function getMoveObjectType(resp: IotaObjectResponse): string | null {
  const c: any = resp.data?.content;
  if (!c || c.dataType !== "moveObject") return null;
  return typeof c.type === "string" ? c.type : null;
}

function deepFindAddr(x: any): string {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (typeof x !== "object") return "";
  const direct = (x.addr ?? x.address) as any;
  if (typeof direct === "string") return direct;
  if (x.fields) {
    const t = deepFindAddr(x.fields);
    if (t) return t;
  }
  if (x.value) {
    const t = deepFindAddr(x.value);
    if (t) return t;
  }
  return "";
}

function deepFindRound(x: any): number | null {
  if (!x) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof x !== "object") return null;
  const direct = (x.round ?? x.r) as any;
  if (direct != null) return deepFindRound(direct);
  if (x.fields) return deepFindRound(x.fields);
  if (x.value) return deepFindRound(x.value);
  return null;
}

function isFieldType(resp: IotaObjectResponse, keyMarker: string, valueMarker: string): boolean {
  const t = getMoveObjectType(resp);
  if (!t) return false;
  return t.includes(keyMarker) && t.includes(valueMarker);
}

function isRevealField(resp: IotaObjectResponse): boolean {
  return isFieldType(resp, "::oracle_task_store::RevealKey", "::oracle_task_store::NodeReveal");
}

function isPartialSigField(resp: IotaObjectResponse): boolean {
  return isFieldType(resp, "::oracle_task_store::PartialSigKey", "::oracle_task_store::NodePartialSig");
}

function isCommitField(resp: IotaObjectResponse): boolean {
  return isFieldType(resp, "::oracle_task_store::CommitKey", "::oracle_task_store::NodeCommit");
}

function isDataField(resp: IotaObjectResponse): boolean {
  return isFieldType(resp, "::oracle_task_store::DataKey", "::oracle_task_store::NodeData");
}

function isNoCommitField(resp: IotaObjectResponse): boolean {
  const t = getMoveObjectType(resp);
  if (!t) return false;
  return t.includes("NoCommitKey") && t.includes("NoCommit");
}

async function readNoCommits(client: IotaClient, taskId: string, round: number) {
  const out = new Set<string>();
  let cursor: string | null | undefined = null;

  for (;;) {
    const page = await client.getDynamicFields({ parentId: taskId, cursor, limit: 50 });
    for (const it of page.data) {
      const hintAddr = deepFindAddr((it as any).name).toLowerCase();
      const hintRound = deepFindRound((it as any).name);
      if (hintRound != null && hintRound !== round) continue;

      const fieldObj = await client.getObject({ id: it.objectId, options: { showContent: true, showType: true } });
      if (!isNoCommitField(fieldObj)) continue;

      const f = getMoveFields(fieldObj);
      if (!f) continue;
      const keyAddr = deepFindAddr(f.name).toLowerCase();
      const keyRound = deepFindRound(f.name);
      if (keyRound != null && keyRound !== round) continue;

      const from = (keyAddr || hintAddr).toLowerCase();
      if (from) out.add(from);
    }

    if (!page.hasNextPage) break;
    cursor = page.nextCursor as any;
  }

  return out;
}

function commitMessage(taskId: string, round: number, hashHex: string): Uint8Array {
  const s = `oracle:commit:v1|taskId=${taskId}|round=${round}|hash=${hashHex}`;
  return new TextEncoder().encode(s);
}

function consensusMessage(taskId: string, round: number, hashHex: string): Uint8Array {
  const s = `oracle:consensus:v2|taskId=${taskId}|round=${round}|hash=${hashHex}`;
  return new TextEncoder().encode(s);
}

function parseAbortCode(msg: string): number | null {
  const m = msg.match(/abort\s+code\s*:\s*(\d+)/i);
  if (m) return Number(m[1]);
  return null;
}

async function readReveals(client: IotaClient, taskId: string, round: number) {
  const out = new Map<string, Uint8Array>();
  let cursor: string | null | undefined = null;

  for (;;) {
    const page = await client.getDynamicFields({ parentId: taskId, cursor, limit: 50 });
    for (const it of page.data) {
      const hintAddr = deepFindAddr((it as any).name).toLowerCase();
      const hintRound = deepFindRound((it as any).name);
      if (hintRound != null && hintRound !== round) continue;

      const fieldObj = await client.getObject({ id: it.objectId, options: { showContent: true, showType: true } });
      if (!isRevealField(fieldObj)) continue;

      const f = getMoveFields(fieldObj);
      if (!f) continue;
      const keyAddr = deepFindAddr(f.name).toLowerCase();
      const keyRound = deepFindRound(f.name);
      if (keyRound != null && keyRound !== round) continue;

      const from = (keyAddr || hintAddr).toLowerCase();
      const vf = (f.value && (f.value.fields ?? f.value)) as any;
      const hashBytes = decodeVecU8(vf?.result_hash);
      if (!from || hashBytes.length !== 32) continue;
      out.set(from, hashBytes);
    }

    if (!page.hasNextPage) break;
    cursor = page.nextCursor as any;
  }

  return out;
}

async function readPartialSigsV2(client: IotaClient, taskId: string, round: number) {
  const out = new Map<string, { resultHash: Uint8Array; sigB64: string }>();
  let cursor: string | null | undefined = null;

  for (;;) {
    const page = await client.getDynamicFields({ parentId: taskId, cursor, limit: 50 });
    for (const it of page.data) {
      const hintAddr = deepFindAddr((it as any).name).toLowerCase();
      const hintRound = deepFindRound((it as any).name);
      if (hintRound != null && hintRound !== round) continue;

      const fieldObj = await client.getObject({ id: it.objectId, options: { showContent: true, showType: true } });
      if (!isPartialSigField(fieldObj)) continue;

      const f = getMoveFields(fieldObj);
      if (!f) continue;
      const keyAddr = deepFindAddr(f.name).toLowerCase();
      const keyRound = deepFindRound(f.name);
      if (keyRound != null && keyRound !== round) continue;

      const from = (keyAddr || hintAddr).toLowerCase();
      const vf = (f.value && (f.value.fields ?? f.value)) as any;
      const resultHash = decodeVecU8(vf?.result_hash);
      const sigBytes = decodeVecU8(vf?.sig);
      if (!from || resultHash.length !== 32 || sigBytes.length === 0) continue;
      out.set(from, { resultHash, sigB64: Buffer.from(sigBytes).toString("base64") });
    }

    if (!page.hasNextPage) break;
    cursor = page.nextCursor as any;
  }

  return out;
}

async function readNodeCommits(client: IotaClient, taskId: string, round: number) {
  const out = new Map<string, { resultHash: Uint8Array; multisigHash: Uint8Array }>();
  let cursor: string | null | undefined = null;

  for (;;) {
    const page = await client.getDynamicFields({ parentId: taskId, cursor, limit: 50 });
    for (const it of page.data) {
      const hintAddr = deepFindAddr((it as any).name).toLowerCase();
      const hintRound = deepFindRound((it as any).name);
      if (hintRound != null && hintRound !== round) continue;

      const fieldObj = await client.getObject({ id: it.objectId, options: { showContent: true, showType: true } });
      if (!isCommitField(fieldObj)) continue;

      const f = getMoveFields(fieldObj);
      if (!f) continue;
      const keyAddr = deepFindAddr(f.name).toLowerCase();
      const keyRound = deepFindRound(f.name);
      if (keyRound != null && keyRound !== round) continue;

      const from = (keyAddr || hintAddr).toLowerCase();
      const vf = (f.value && (f.value.fields ?? f.value)) as any;
      const resultHash = decodeVecU8(vf?.result_hash);
      const multisigHash = decodeVecU8(vf?.multisig_hash);
      if (!from || resultHash.length !== 32 || multisigHash.length !== 32) continue;
      out.set(from, { resultHash, multisigHash });
    }

    if (!page.hasNextPage) break;
    cursor = page.nextCursor as any;
  }

  return out;
}

async function readNodeData(client: IotaClient, taskId: string, round: number) {
  const out = new Map<string, { bytes: Uint8Array; hasValue: number; valueU64: number }>();
  let cursor: string | null | undefined = null;

  for (;;) {
    const page = await client.getDynamicFields({ parentId: taskId, cursor, limit: 50 });
    for (const it of page.data) {
      const hintAddr = deepFindAddr((it as any).name).toLowerCase();
      const hintRound = deepFindRound((it as any).name);
      if (hintRound != null && hintRound !== round) continue;

      const fieldObj = await client.getObject({ id: it.objectId, options: { showContent: true, showType: true } });
      if (!isDataField(fieldObj)) continue;

      const f = getMoveFields(fieldObj);
      if (!f) continue;
      const keyAddr = deepFindAddr(f.name).toLowerCase();
      const keyRound = deepFindRound(f.name);
      if (keyRound != null && keyRound !== round) continue;

      const from = (keyAddr || hintAddr).toLowerCase();
      const vf = (f.value && (f.value.fields ?? f.value)) as any;
      const bytes = decodeVecU8(vf?.bytes);
      const hasValue = Number(vf?.has_value ?? 0);
      const valueU64 = Number(vf?.value_u64 ?? 0);
      if (!from) continue;
      out.set(from, {
        bytes,
        hasValue: Number.isFinite(hasValue) ? hasValue : 0,
        valueU64: Number.isFinite(valueU64) ? valueU64 : 0,
      });
    }

    if (!page.hasNextPage) break;
    cursor = page.nextCursor as any;
  }

  return out;
}

export async function waitForMatchingNodeCommits(opts: {
  client: IotaClient;
  taskId: string;
  round: number;
  assigned: string[];
  expectedResultHashHex: string;
  expectedMultisigHashHex: string;
  minCount: number;
  waitMs?: number;
  pollMs?: number;
}): Promise<{ count: number; matchingBy: string[] }> {
  const { client, taskId, round, assigned, expectedResultHashHex, expectedMultisigHashHex, minCount } = opts;
  const waitMs = opts.waitMs ?? optInt("NODE_COMMIT_WAIT_MS", 20_000);
  const pollMs = opts.pollMs ?? optInt("NODE_COMMIT_POLL_MS", 1_200);
  const assignedSet = new Set(assigned.map((a) => a.toLowerCase()));
  const wantResult = expectedResultHashHex.toLowerCase();
  const wantMulti = expectedMultisigHashHex.toLowerCase();
  const started = Date.now();

  let bestMatching: string[] = [];
  while (Date.now() - started < waitMs) {
    const commits = await readNodeCommits(client, taskId, round);
    const matchingBy = Array.from(commits.entries())
      .filter(
        ([addr, v]) =>
          assignedSet.has(addr) && toHex(v.resultHash) === wantResult && toHex(v.multisigHash) === wantMulti,
      )
      .map(([addr]) => addr)
      .sort();

    if (matchingBy.length > bestMatching.length) bestMatching = matchingBy;
    if (matchingBy.length >= minCount) return { count: matchingBy.length, matchingBy };
    await sleep(pollMs);
  }

  return { count: bestMatching.length, matchingBy: bestMatching };
}

export async function waitForDataSubmissions(opts: {
  client: IotaClient;
  taskId: string;
  round: number;
  assigned: string[];
  waitMs?: number;
  pollMs?: number;
}): Promise<{ count: number; submittedBy: string[] }> {
  const { client, taskId, round, assigned } = opts;
  const waitMs = opts.waitMs ?? optInt("DATA_SUBMIT_WAIT_MS", 20_000);
  const pollMs = opts.pollMs ?? optInt("DATA_SUBMIT_POLL_MS", 1_200);
  const assignedSet = new Set(assigned.map((a) => a.toLowerCase()));
  const started = Date.now();

  let bestSubmitted: string[] = [];
  while (Date.now() - started < waitMs) {
    const data = await readNodeData(client, taskId, round);
    const submittedBy = Array.from(data.keys())
      .filter((a) => assignedSet.has(a))
      .sort();
    if (submittedBy.length > bestSubmitted.length) bestSubmitted = submittedBy;
    if (submittedBy.length >= assignedSet.size) return { count: submittedBy.length, submittedBy };
    await sleep(pollMs);
  }

  return { count: bestSubmitted.length, submittedBy: bestSubmitted };
}

export async function publishCommitSignature(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  round: number;
  normalizedText: string;
}) {
  const { client, keypair, taskId, round, normalizedText } = opts;
  const pkg = getTasksPackageId();
  const clockId = getClockId();
  const { runtimeId } = await loadTaskBundle(client, taskId);
  if (!runtimeId) throw new Error(`Missing runtime_id for task ${taskId}`);

  const resultBytes = new TextEncoder().encode(normalizedText);
  const resultHash = sha256Bytes(resultBytes);
  const hashHex = toHex(resultHash);

  const msg = commitMessage(taskId, round, hashHex);
  const sigB64 = (await keypair.signPersonalMessage(msg)).signature;
  const sigBytes = Uint8Array.from(Buffer.from(sigB64, "base64"));

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(optInt("GAS_BUDGET_COMMIT_SIG", optInt("GAS_BUDGET", 50_000_000)));
      tx.moveCall({
        target: `${pkg}::oracle_tasks::submit_commit_signature`,
        arguments: [tx.object(taskId), tx.object(runtimeId), tx.object(clockId), tx.pure(bcsVecU8(sigBytes))],
      });
      return tx;
    },
    options: { showEffects: true },
    label: "publishCommitSignature",
  });

  return { digest: res.digest as string, resultHash, hashHex, commitSigB64: sigB64 };
}

export async function publishNoCommit(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  round: number;
  reasonCode: number;
  message: string;
}): Promise<string> {
  const { client, keypair, taskId, round, reasonCode, message } = opts;
  const pkg = getTasksPackageId();
  const maxChars = optInt("NO_COMMIT_DETAILS_MAX_CHARS", 1024);
  const detailsBytes = new TextEncoder().encode((message || "no_commit").slice(0, Math.max(64, maxChars)));

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(optInt("GAS_BUDGET_NO_COMMIT", optInt("GAS_BUDGET", 30_000_000)));
      tx.moveCall({
        target: `${pkg}::oracle_messages::publish_no_commit`,
        arguments: [
          tx.object(taskId),
          tx.pure(bcsU64(round)),
          tx.pure(bcsU64(reasonCode)),
          tx.pure(bcsVecU8(detailsBytes)),
        ],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: "publishNoCommit",
  });

  return res.digest as string;
}

export async function tryCloseCommitPhase(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
}): Promise<string> {
  const { client, keypair, taskId } = opts;
  const pkg = getTasksPackageId();
  const clockId = getClockId();
  const { runtimeId } = await loadTaskBundle(client, taskId);
  if (!runtimeId) throw new Error(`Missing runtime_id for task ${taskId}`);

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(optInt("GAS_BUDGET_CLOSE_COMMIT", optInt("GAS_BUDGET", 30_000_000)));
      tx.moveCall({
        target: `${pkg}::oracle_tasks::close_commit_phase`,
        arguments: [tx.object(taskId), tx.object(runtimeId), tx.object(clockId)],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: "tryCloseCommitPhase",
  });

  return res.digest as string;
}

export async function publishRevealHash(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  round: number;
  resultHash: Uint8Array;
}) {
  const { client, keypair, taskId, resultHash } = opts;
  const pkg = getTasksPackageId();
  const clockId = getClockId();
  const { runtimeId } = await loadTaskBundle(client, taskId);
  if (!runtimeId) throw new Error(`Missing runtime_id for task ${taskId}`);

  if (resultHash.length !== 32) throw new Error("resultHash must be 32 bytes");

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(optInt("GAS_BUDGET_REVEAL", optInt("GAS_BUDGET", 50_000_000)));
      tx.moveCall({
        target: `${pkg}::oracle_tasks::submit_reveal_hash`,
        arguments: [tx.object(taskId), tx.object(runtimeId), tx.object(clockId), tx.pure(bcsVecU8(resultHash))],
      });
      return tx;
    },
    options: { showEffects: true },
    label: "publishRevealHash",
  });

  return { digest: res.digest as string };
}

export async function waitForWinningHash(opts: {
  client: IotaClient;
  taskId: string;
  round: number;
  assigned: string[];
  quorumK: number;
  waitMs?: number;
  pollMs?: number;
}) {
  const { client, taskId, round, assigned, quorumK } = opts;
  const waitMs = opts.waitMs ?? optInt("REVEAL_WAIT_MS", 60_000);
  const pollMs = opts.pollMs ?? optInt("REVEAL_POLL_MS", 1_500);
  const assignedSet = new Set(assigned.map((a) => a.toLowerCase()));
  const started = Date.now();

  while (Date.now() - started < waitMs) {
    const [reveals, noCommits, { taskFields }] = await Promise.all([
      readReveals(client, taskId, round),
      readNoCommits(client, taskId, round).catch(() => new Set<string>()),
      loadTaskBundle(client, taskId),
    ]);
    const counts = new Map<string, number>();

    for (const [addr, resultHash] of reveals.entries()) {
      if (!assignedSet.has(addr)) continue;
      const hashHex = toHex(resultHash);
      counts.set(hashHex, (counts.get(hashHex) ?? 0) + 1);
    }

    let bestHash = "";
    let bestCount = 0;
    for (const [hashHex, count] of counts.entries()) {
      if (count > bestCount) {
        bestHash = hashHex;
        bestCount = count;
      }
    }

    if (bestCount >= quorumK && bestHash) {
      return { ok: true as const, hashHex: bestHash, count: bestCount };
    }

    let accounted = 0;
    for (const addr of assignedSet) {
      if (reveals.has(addr) || noCommits.has(addr)) accounted += 1;
    }

    const state = Number(taskFields.state ?? -1);
    if (accounted >= assignedSet.size && bestCount < quorumK) {
      return {
        ok: false as const,
        reason: "no_quorum",
        bestHashHex: bestHash,
        bestCount,
        accounted,
        noCommitCount: noCommits.size,
      };
    }

    // Do not fail early just because the task state moved beyond reveal phase.
    // Dynamic-field reads can lag behind the shared-object state, especially when
    // a node republishes the reveal after a shared-object/version retry. In that
    // window another node may already see state=3/4 while still missing one reveal.
    // Waiting until timeout (or until all assigned nodes are accounted for) avoids
    // false no_quorum outcomes on valid STORAGE rounds.
    void state;

    await sleep(pollMs);
  }

  return { ok: false as const, reason: "timeout" };
}

export async function publishPartialSigV2(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  round: number;
  resultHash: Uint8Array;
}) {
  const { client, keypair, taskId, round, resultHash } = opts;
  const pkg = getTasksPackageId();
  if (resultHash.length !== 32) throw new Error("resultHash must be 32 bytes");

  const hashHex = toHex(resultHash);
  const msg = consensusMessage(taskId, round, hashHex);
  const sigB64 = (await keypair.signPersonalMessage(msg)).signature;
  const sigBytes = Uint8Array.from(Buffer.from(sigB64, "base64"));

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(envIntAlias("GAS_BUDGET_PARTIAL", "GAS_BUDGET_PARTIAL_SIG", optInt("GAS_BUDGET", 50_000_000)));
      tx.moveCall({
        target: `${pkg}::oracle_tasks::submit_partial_signature_v2`,
        arguments: [tx.object(taskId), tx.pure(bcsVecU8(resultHash)), tx.pure(bcsVecU8(sigBytes))],
      });
      return tx;
    },
    options: { showEffects: true },
    label: "publishPartialSigV2",
  });

  return { digest: res.digest as string, sigB64, message: msg };
}

async function submitNodeCommit(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  resultHash: Uint8Array;
  multisigHash: Uint8Array;
}) {
  const { client, keypair, taskId, resultHash, multisigHash } = opts;
  const pkg = getTasksPackageId();

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(optInt("GAS_BUDGET_NODE_COMMIT", optInt("GAS_BUDGET", 60_000_000)));
      tx.moveCall({
        target: `${pkg}::oracle_tasks::submit_node_commit`,
        arguments: [tx.object(taskId), tx.pure(bcsVecU8(resultHash)), tx.pure(bcsVecU8(multisigHash))],
      });
      return tx;
    },
    options: { showEffects: true },
    label: "submitNodeCommit",
  });

  return res.digest as string;
}

async function tryFinalizeTask(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  resultBytes: Uint8Array;
  multisigBytes: Uint8Array;
  multisigAddr: string;
  gasBudget: number;
}) {
  const { client, keypair, taskId, resultBytes, multisigBytes, multisigAddr, gasBudget } = opts;
  const pkg = getTasksPackageId();
  const clockId = getClockId();
  const { runtimeId } = await loadTaskBundle(client, taskId);
  if (!runtimeId) throw new Error(`Missing runtime_id for task ${taskId}`);

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(gasBudget);
      tx.moveCall({
        target: `${pkg}::oracle_tasks::finalize_task`,
        arguments: [
          tx.object(taskId),
          tx.object(runtimeId),
          tx.object(clockId),
          tx.pure(bcsVecU8(resultBytes)),
          tx.pure(bcsVecU8(multisigBytes)),
          tx.pure(bcsAddress(multisigAddr)),
        ],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: "tryFinalizeTask",
  });

  return res.digest as string;
}

function pickDeterministicSigners(assignedSorted: string[], available: Set<string>, quorumK: number): string[] {
  const out: string[] = [];
  for (const addr of assignedSorted) {
    if (available.has(addr)) out.push(addr);
    if (out.length >= quorumK) break;
  }
  return out;
}

export async function combineCommitAndFinalizeV2(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  round: number;
  normalizedText: string;
  assigned: string[];
  quorumK: number;
  pubkeysByAddrB64: Map<string, string>;
  winningHashHex: string;
}) {
  const { client, keypair, taskId, round, normalizedText, assigned, quorumK, pubkeysByAddrB64, winningHashHex } = opts;

  const assignedSorted = assigned.map((a) => a.toLowerCase()).sort();
  const myAddr = keypair.getPublicKey().toIotaAddress().toLowerCase();
  const leader = assignedSorted[0] ?? "";

  const leaderOnlyFinalize = envBool("LEADER_ONLY_FINALIZE", true);
  const backupDelayMs = optInt("NON_LEADER_FINALIZE_DELAY_MS", 15_000);
  const collectWaitMs = optInt("PARTIAL_COLLECT_WAIT_MS", 60_000);
  const collectPollMs = optInt("PARTIAL_COLLECT_POLL_MS", 2_000);

  const winningHashBytes = Uint8Array.from(Buffer.from(winningHashHex, "hex"));
  if (winningHashBytes.length !== 32) throw new Error("winningHashHex must be 32 bytes hex");

  const started = Date.now();
  let partials = new Map<string, { resultHash: Uint8Array; sigB64: string }>();

  while (Date.now() - started < collectWaitMs) {
    partials = await readPartialSigsV2(client, taskId, round);
    const available = new Set<string>();
    for (const [addr, partial] of partials.entries()) {
      if (toHex(partial.resultHash) === winningHashHex) available.add(addr);
    }
    const chosen = pickDeterministicSigners(assignedSorted, available, quorumK);
    if (chosen.length >= quorumK) break;
    await sleep(collectPollMs);
  }

  const available = new Set<string>();
  for (const [addr, partial] of partials.entries()) {
    if (toHex(partial.resultHash) === winningHashHex) available.add(addr);
  }
  const chosenAddrs = pickDeterministicSigners(assignedSorted, available, quorumK);

  console.log(
    `[multisig] round=${round} collected=${available.size}/${quorumK} chosen=${chosenAddrs.length}/${quorumK} from=${chosenAddrs.join(",")}`,
  );

  if (chosenAddrs.length < quorumK) {
    console.log(`[multisig] not enough partial signatures (${chosenAddrs.length}/${quorumK}) -> skip finalize`);
    return;
  }

  const pubsSorted: Array<{ nodeId: string; pubKeyBase64: string }> = [];
  for (const addr of assignedSorted) {
    const pk = pubkeysByAddrB64.get(addr);
    if (!pk) throw new Error(`Missing pubkey for ${addr}`);
    pubsSorted.push({ nodeId: addr, pubKeyBase64: pk });
  }

  const multiPk = buildMultiSigPublicKey(quorumK, pubsSorted);
  const multisigAddr = multiPk.toIotaAddress();
  assertCommitteeMultisigAddress({
    threshold: quorumK,
    pubs: pubsSorted,
    multisigAddr,
    context: `taskSignFlow.finalize task=${taskId} round=${round}`,
  });
  const chosenSigs = chosenAddrs.map((addr) => partials.get(addr)!.sigB64);
  const combinedSigB64 = multiPk.combinePartialSignatures(chosenSigs);

  const msg = consensusMessage(taskId, round, winningHashHex);
  let verified = false;
  try {
    verified = await multiPk.verifyPersonalMessage(msg, combinedSigB64);
  } catch {
    verified = false;
  }

  console.log(`[multisig] round=${round} address=${multisigAddr} verified=${verified}`);
  if (!verified) throw new Error("Combined multisig signature verification failed");

  const resultBytes = new TextEncoder().encode(normalizedText);
  const resultHash = sha256Bytes(resultBytes);
  const resultHashHex = toHex(resultHash);
  if (resultHashHex !== winningHashHex) {
    throw new Error(`Local result hash != winning hash (local=${resultHashHex} win=${winningHashHex})`);
  }

  const multisigBytes = Uint8Array.from(Buffer.from(combinedSigB64, "base64"));
  const multisigHash = sha256Bytes(multisigBytes);
  const nodeCommitDigest = await submitNodeCommit({ client, keypair, taskId, resultHash, multisigHash });
  console.log(`[node_commit] tx=${nodeCommitDigest}`);

  const multisigHashHex = toHex(multisigHash);
  if (myAddr === leader) {
    const commitSeen = await waitForMatchingNodeCommits({
      client,
      taskId,
      round,
      assigned: assignedSorted,
      expectedResultHashHex: winningHashHex,
      expectedMultisigHashHex: multisigHashHex,
      minCount: quorumK,
      waitMs: optInt("WAIT_MATCHING_NODE_COMMITS_MS", 20_000),
      pollMs: optInt("WAIT_MATCHING_NODE_COMMITS_POLL_MS", 1_200),
    });
    console.log(`[finalize] matching node commits observed=${commitSeen.count}/${quorumK}`);
  }

  if (leaderOnlyFinalize && myAddr !== leader) {
    console.log(`[finalize] backup attempt (not leader). leader=${leader} me=${myAddr}`);
    await sleep(backupDelayMs);
  }

  const finalizeWaitMs = optInt("FINALIZE_WAIT_MS", 60_000);
  const finalizePollMs = optInt("FINALIZE_POLL_MS", 2_500);
  let gasBudget = optInt("GAS_BUDGET_FINALIZE", 250_000_000);

  const finalizeStarted = Date.now();
  while (Date.now() - finalizeStarted < finalizeWaitMs) {
    try {
      const digest = await tryFinalizeTask({
        client,
        keypair,
        taskId,
        resultBytes,
        multisigBytes,
        multisigAddr,
        gasBudget,
      });
      console.log(`[finalize] tx=${digest}`);
      return;
    } catch (e: any) {
      const msg2 = String(e?.message ?? e);
      const code = parseAbortCode(msg2);

      if (code === 300) {
        console.log("[finalize] skip (already finalized)");
        return;
      }

      if (code === 210 || /badphase/i.test(msg2)) {
        console.log(`[finalize] stop (bad phase): ${msg2}`);
        return;
      }

      if (/insufficient\s+gas/i.test(msg2)) {
        gasBudget = Math.floor(gasBudget * 1.4);
        console.warn(`[finalize] insufficient gas -> retry with GAS_BUDGET_FINALIZE=${gasBudget}`);
        await sleep(500);
        continue;
      }

      await sleep(finalizePollMs);
    }
  }

  console.warn(`[finalize] timeout after ${finalizeWaitMs}ms`);
}

export async function requestDataPublication(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
}): Promise<string> {
  const { client, keypair, taskId } = opts;
  const pkg = getTasksPackageId();
  const clockId = getClockId();
  const { runtimeId } = await loadTaskBundle(client, taskId);
  if (!runtimeId) throw new Error(`Missing runtime_id for task ${taskId}`);

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(
        envIntAlias("GAS_BUDGET_REQUEST_DATA", "GAS_BUDGET_TRIGGER_NO_CONSENSUS", optInt("GAS_BUDGET", 50_000_000)),
      );
      tx.moveCall({
        target: `${pkg}::oracle_tasks::request_data_publication`,
        arguments: [tx.object(taskId), tx.object(runtimeId), tx.object(clockId)],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: "requestDataPublication",
  });

  return res.digest as string;
}

export async function triggerDataRequestByFinalize(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  resultBytes?: Uint8Array;
}): Promise<string> {
  return requestDataPublication({ client: opts.client, keypair: opts.keypair, taskId: opts.taskId });
}

export async function publishResultData(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  dataBytes: Uint8Array;
  hasValue: number;
  valueU64: number;
}): Promise<string> {
  const { client, keypair, taskId, dataBytes, hasValue, valueU64 } = opts;
  const pkg = getTasksPackageId();

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(optInt("GAS_BUDGET_SUBMIT_DATA", optInt("GAS_BUDGET", 50_000_000)));
      tx.moveCall({
        target: `${pkg}::oracle_tasks::submit_result_data`,
        arguments: [
          tx.object(taskId),
          tx.pure(bcsVecU8(dataBytes)),
          tx.pure(bcsU8(hasValue ? 1 : 0)),
          tx.pure(bcsU64(valueU64)),
        ],
      });
      return tx;
    },
    options: { showEffects: true },
    label: "publishResultData",
  });

  return res.digest as string;
}

export async function tryCloseDataPhase(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
}): Promise<string> {
  const { client, keypair, taskId } = opts;
  const pkg = getTasksPackageId();
  const clockId = getClockId();
  const { configId, runtimeId } = await loadTaskBundle(client, taskId);
  if (!configId || !runtimeId) throw new Error(`Missing config_id/runtime_id for task ${taskId}`);

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(optInt("GAS_BUDGET_CLOSE_DATA", optInt("GAS_BUDGET", 50_000_000)));
      tx.moveCall({
        target: `${pkg}::oracle_tasks::close_data_phase`,
        arguments: [tx.object(taskId), tx.object(configId), tx.object(runtimeId), tx.object(clockId)],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: "tryCloseDataPhase",
  });

  return res.digest as string;
}

async function reportMediationBlocked(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  observedVariance: number;
}): Promise<string> {
  const { client, keypair, taskId, observedVariance } = opts;
  const pkg = getTasksPackageId();
  const { configId, runtimeId } = await loadTaskBundle(client, taskId);
  if (!configId || !runtimeId) throw new Error(`Missing config_id/runtime_id for task ${taskId}`);

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(optInt("GAS_BUDGET_REPORT_MEDIATION_BLOCKED", optInt("GAS_BUDGET", 80_000_000)));
      tx.moveCall({
        target: `${pkg}::oracle_tasks::report_mediation_blocked`,
        arguments: [tx.object(taskId), tx.object(configId), tx.object(runtimeId), tx.pure(bcsU64(observedVariance))],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: "reportMediationBlocked",
  });

  return res.digest as string;
}

export async function tryStartMediationRoundFromOnchainData(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  failedRound: number;
  leaderAddr: string;
  myAddr: string;
}): Promise<{ started: boolean; reason?: string; variance?: number; mean?: number; digest?: string }> {
  const { client, keypair, taskId, failedRound, leaderAddr, myAddr } = opts;

  if (myAddr.toLowerCase() !== leaderAddr.toLowerCase()) {
    return { started: false, reason: "not_leader" };
  }

  const { taskFields, configFields, configId, runtimeId } = await loadTaskBundle(client, taskId);
  const state = Number(taskFields.state ?? -1);
  const mediationMode = Number(configFields.mediation_mode ?? 0);
  const varianceMax = Number(configFields.variance_max ?? 0);

  if (state !== 4) return { started: false, reason: `state_${state}` };
  if (mediationMode !== 1) return { started: false, reason: "mediation_disabled" };
  if (!configId || !runtimeId) return { started: false, reason: "missing_config_or_runtime" };

  const data = await readNodeData(client, taskId, failedRound);
  const values: number[] = [];
  for (const entry of data.values()) {
    if (entry.hasValue === 1) values.push(entry.valueU64);
  }
  if (values.length === 0) return { started: false, reason: "no_numeric_values" };

  let minV = values[0];
  let maxV = values[0];
  let sum = 0;
  for (const value of values) {
    if (value < minV) minV = value;
    if (value > maxV) maxV = value;
    sum += value;
  }

  const mean = Math.floor(sum / values.length);
  const variance = maxV - minV;

  if (variance > varianceMax) {
    const digest = await reportMediationBlocked({ client, keypair, taskId, observedVariance: variance });
    return { started: false, reason: "variance_too_high", variance, mean, digest };
  }

  const mediatedText = `[${mean}]`;
  const mediatedBytes = new TextEncoder().encode(mediatedText);
  const pkg = getTasksPackageId();
  const clockId = getClockId();

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(optInt("GAS_BUDGET_START_MEDIATION", 120_000_000));
      tx.moveCall({
        target: `${pkg}::oracle_tasks::start_mediation_round`,
        arguments: [
          tx.object(taskId),
          tx.object(configId),
          tx.object(runtimeId),
          tx.object(clockId),
          tx.pure(bcsVecU8(mediatedBytes)),
          tx.pure(bcsU64(variance)),
        ],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: "start_mediation_round",
  });

  return { started: true, digest: res.digest as string, variance, mean };
}
