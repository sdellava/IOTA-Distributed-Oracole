// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { IotaClient } from '@iota/iota-sdk/client';
import { Transaction } from '@iota/iota-sdk/transactions';
import type { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';

import { bcsU64, bcsVecU8, bcsAddress, bcsU8, bcsVecAddress } from './bcs';
import { signAndExecuteWithLockRetry } from './txRetry.js';

export const MSG_COMMIT = 2;
export const MSG_REVEAL = 3;
export const MSG_PARTIAL = 4;
export const MSG_LEADER_INTENT = 5;
export const MSG_ABORT_INTENT = 6;
export const MSG_NO_COMMIT = 7;

function mustEnv(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function tasksPkg(): string {
  return process.env.ORACLE_TASKS_PACKAGE_ID?.trim() || mustEnv('ORACLE_PACKAGE_ID');
}

function clockId(): string {
  return (process.env.IOTA_CLOCK_ID?.trim() || '0x6').trim() || '0x6';
}

function taskRegistryId(): string {
  return mustEnv('ORACLE_TASK_REGISTRY_ID');
}

function gasBudget(envKey: string, def: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}


export function commitMessage(taskId: string, round: number, resultHashHex: string): Uint8Array {
  return new TextEncoder().encode(`oracle:commit:v1|taskId=${taskId}|round=${round}|hash=${resultHashHex}`);
}

export function consensusMessage(taskId: string, round: number, resultHashHex: string): Uint8Array {
  return new TextEncoder().encode(`oracle:consensus:v3|taskId=${taskId}|round=${round}|hash=${resultHashHex}`);
}

async function signBytes(keypair: Ed25519Keypair, bytes: Uint8Array): Promise<Uint8Array> {
  const sigB64 = (await keypair.signPersonalMessage(bytes)).signature;
  return Uint8Array.from(Buffer.from(sigB64, 'base64'));
}

async function publishMessageTx(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  target: string;
  args: (tx: Transaction) => any[];
  label: string;
}) {
  const { client, keypair, target, args, label } = opts;
  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(gasBudget('GAS_BUDGET_MESSAGE', gasBudget('GAS_BUDGET', 20_000_000)));
      tx.moveCall({ target, arguments: args(tx) });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label,
  });
  await client.waitForTransaction({ digest: res.digest });
  return String(res.digest);
}


export async function publishCommit(opts: {
  client: IotaClient; keypair: Ed25519Keypair; taskId: string; round: number; resultHashHex: string;
}) {
  const hashBytes = Uint8Array.from(Buffer.from(opts.resultHashHex, 'hex'));
  const sig = await signBytes(opts.keypair, commitMessage(opts.taskId, opts.round, opts.resultHashHex));
  return publishMessageTx({
    client: opts.client,
    keypair: opts.keypair,
    taskId: opts.taskId,
    target: `${tasksPkg()}::oracle_messages::publish_commit`,
    args: (tx) => [tx.object(opts.taskId), tx.pure(bcsU64(opts.round)), tx.pure(bcsVecU8(hashBytes)), tx.pure(bcsVecU8(sig))],
    label: 'publish_commit',
  });
}

export async function publishReveal(opts: {
  client: IotaClient; keypair: Ed25519Keypair; taskId: string; round: number; normalizedBytes: Uint8Array; resultHashHex: string;
  numericValueU64?: number | null;
}) {
  const sig = await signBytes(opts.keypair, commitMessage(opts.taskId, opts.round, opts.resultHashHex));
  const numericValue = opts.numericValueU64 == null ? 0 : Math.max(0, Math.floor(opts.numericValueU64));
  const hasNumeric = opts.numericValueU64 == null ? 0 : 1;
  return publishMessageTx({
    client: opts.client,
    keypair: opts.keypair,
    taskId: opts.taskId,
    target: `${tasksPkg()}::oracle_messages::publish_reveal`,
    args: (tx) => [
      tx.object(opts.taskId),
      tx.pure(bcsU64(opts.round)),
      tx.pure(bcsVecU8(opts.normalizedBytes)),
      tx.pure(bcsVecU8(sig)),
      tx.pure(bcsU64(numericValue)),
      tx.pure(bcsU64(hasNumeric)),
    ],
    label: 'publish_reveal',
  });
}

export async function publishPartialSignature(opts: {
  client: IotaClient; keypair: Ed25519Keypair; taskId: string; round: number; resultHashHex: string;
}) {
  const msg = consensusMessage(opts.taskId, opts.round, opts.resultHashHex);
  const sig = await signBytes(opts.keypair, msg);
  return publishMessageTx({
    client: opts.client,
    keypair: opts.keypair,
    taskId: opts.taskId,
    target: `${tasksPkg()}::oracle_messages::publish_partial_signature`,
    args: (tx) => [tx.object(opts.taskId), tx.pure(bcsU64(opts.round)), tx.pure(bcsVecU8(sig)), tx.pure(bcsVecU8(msg))],
    label: 'publish_partial_signature',
  });
}

export async function publishLeaderIntent(opts: {
  client: IotaClient; keypair: Ed25519Keypair; taskId: string; round: number; finalizeMode: number; details: Uint8Array;
}) {
  const sig = await signBytes(opts.keypair, opts.details);
  return publishMessageTx({
    client: opts.client,
    keypair: opts.keypair,
    taskId: opts.taskId,
    target: `${tasksPkg()}::oracle_messages::publish_leader_intent`,
    args: (tx) => [
      tx.object(opts.taskId),
      tx.pure(bcsU64(opts.round)),
      tx.pure(bcsU64(opts.finalizeMode)),
      tx.pure(bcsVecU8(opts.details)),
      tx.pure(bcsVecU8(sig)),
    ],
    label: 'publish_leader_intent',
  });
}

export async function finalizeTaskWithCertificate(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  resultBytes: Uint8Array;
  multisigBytes: Uint8Array;
  multisigAddr: string;
  signerAddrs: string[];
  certificateBlob: Uint8Array;
  finalizeMode: number;
}) {
  const res = await signAndExecuteWithLockRetry({
    client: opts.client,
    signer: opts.keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(gasBudget('GAS_BUDGET_FINALIZE', gasBudget('GAS_BUDGET', 40_000_000)));
      tx.moveCall({
        target: `${tasksPkg()}::oracle_tasks::finalize_task_with_certificate`,
        arguments: [
          tx.object(taskRegistryId()),
          tx.object(opts.taskId),
          tx.pure(bcsVecU8(opts.resultBytes)),
          tx.pure(bcsVecU8(opts.multisigBytes)),
          tx.pure(bcsAddress(opts.multisigAddr)),
          tx.pure(bcsVecAddress(opts.signerAddrs.map((a) => a.toLowerCase()))),
          tx.pure(bcsVecU8(opts.certificateBlob)),
          tx.pure(bcsU8(opts.finalizeMode)),
          tx.object(clockId()),
        ],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: 'finalize_task_with_certificate',
  });
  await opts.client.waitForTransaction({ digest: res.digest });
  return String(res.digest);
}

export async function abortTaskWithCertificate(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  reasonCode: number;
  multisigBytes: Uint8Array;
  multisigAddr: string;
  signerAddrs: string[];
  certificateBlob: Uint8Array;
}) {
  const res = await signAndExecuteWithLockRetry({
    client: opts.client,
    signer: opts.keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(gasBudget('GAS_BUDGET_ABORT', gasBudget('GAS_BUDGET', 35_000_000)));
        tx.moveCall({
        target: `${tasksPkg()}::oracle_tasks::abort_task_with_certificate`,
        arguments: [
          tx.object(taskRegistryId()),
          tx.object(opts.taskId),
          tx.pure(bcsU64(Math.max(1, Math.floor(opts.reasonCode)))),
          tx.pure(bcsVecU8(opts.multisigBytes)),
          tx.pure(bcsAddress(opts.multisigAddr)),
          tx.pure(bcsVecAddress(opts.signerAddrs.map((a) => a.toLowerCase()))),
          tx.pure(bcsVecU8(opts.certificateBlob)),
          tx.object(clockId()),
        ],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: 'abort_task_with_certificate',
  });
  await opts.client.waitForTransaction({ digest: res.digest });
  return String(res.digest);
}

export async function startMediation(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  taskId: string;
  observedVariance: number;
}) {
  const res = await signAndExecuteWithLockRetry({
    client: opts.client,
    signer: opts.keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(gasBudget('GAS_BUDGET_MEDIATION', gasBudget('GAS_BUDGET', 30_000_000)));
      tx.moveCall({
        target: `${tasksPkg()}::oracle_tasks::start_mediation`,
        arguments: [
          tx.object(opts.taskId),
          tx.pure(bcsU64(Math.max(0, Math.floor(opts.observedVariance)))),
        ],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true },
    label: 'start_mediation',
  });
  await opts.client.waitForTransaction({ digest: res.digest });
  return String(res.digest);
}

export type OracleMessage = {
  taskId: string;
  round: number;
  kind: number;
  sender: string;
  payload: Uint8Array;
  signature: Uint8Array;
  value0: number;
  value1: number;
  value2: number;
  timestampMs: number;
};

function decodeVecU8(v: any): Uint8Array {
  if (v == null) return new Uint8Array();
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v.map((n) => Number(n) & 0xff));
  if (typeof v === 'object') {
    if (Array.isArray(v.bytes)) return Uint8Array.from(v.bytes.map((n: any) => Number(n) & 0xff));
    if (v.value != null) return decodeVecU8(v.value);
    if (v.fields != null) return decodeVecU8(v.fields);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return new Uint8Array();
    if (s.startsWith('0x')) return Uint8Array.from(Buffer.from(s.slice(2), 'hex'));
    try { return Uint8Array.from(Buffer.from(s, 'base64')); } catch { return new Uint8Array(); }
  }
  return new Uint8Array();
}

export async function readOracleMessages(
  client: IotaClient,
  taskId: string,
  round: number,
  opts?: { minTimestampMs?: number },
): Promise<OracleMessage[]> {
  const moveEventType = `${tasksPkg()}::oracle_messages::OracleMessage`;
  const page: any = await client.queryEvents({
    query: { MoveEventType: moveEventType },
    cursor: null,
    limit: 200,
    order: 'descending',
  } as any);
  const out: OracleMessage[] = [];
  const seen = new Set<string>();
  for (const ev of page?.data ?? []) {
    const pj: any = ev?.parsedJson ?? {};
    const tid = String(pj.task_id ?? '');
    const r = Number(pj.round ?? -1);
    const timestampMs = Number(ev?.timestampMs ?? 0);
    const sender = String(pj.sender ?? '').toLowerCase();
    const kind = Number(pj.kind ?? 0);
    const key = `${tid}:${r}:${kind}:${sender}:${Buffer.from(decodeVecU8(pj.payload)).toString('hex')}`;
    if (tid !== taskId || r !== round || seen.has(key)) continue;
    if ((opts?.minTimestampMs ?? 0) > 0 && timestampMs > 0 && timestampMs < (opts?.minTimestampMs ?? 0)) continue;
    seen.add(key);
    out.push({
      taskId: tid,
      round: r,
      kind,
      sender,
      payload: decodeVecU8(pj.payload),
      signature: decodeVecU8(pj.signature),
      value0: Number(pj.value0 ?? 0),
      value1: Number(pj.value1 ?? 0),
      value2: Number(pj.value2 ?? 0),
      timestampMs,
    });
  }
  return out.reverse();
}
