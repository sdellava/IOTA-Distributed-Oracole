import type { IotaClient } from '@iota/iota-sdk/client';

function envInt(name: string, def: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.floor(n);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs(): number {
  const minMs = envInt('TX_LOCK_RETRY_MIN_MS', 1_000);
  const maxMs = envInt('TX_LOCK_RETRY_MAX_MS', 3_000);
  const lo = Math.max(0, Math.min(minMs, maxMs));
  const hi = Math.max(lo, Math.max(minMs, maxMs));
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

export function isRetryableSharedObjectError(error: unknown): boolean {
  const msg = String((error as any)?.message ?? error ?? '').toLowerCase();
  if (!msg) return false;

  return [
    'reserved for another transaction',
    'objects is reserved for another transaction',
    'one or more of its objects is reserved',
    'failed to sign transaction by a quorum of validators because one or more of its objects is reserved',
    'object is reserved for another transaction',
    'shared object is reserved',
    'object lock',
    'objects lock',
    'object locked',
    'objects locked',
    'input object',
    'equivocated until the next epoch',
    'is not available for consumption, current version',
    'current version:',
    'transaction execution failed due to issues with transaction inputs',
  ].some((needle) => msg.includes(needle));
}

export async function signAndExecuteWithLockRetry<T = any>(opts: {
  client: IotaClient;
  signer: any;
  transactionFactory: () => any;
  options?: Record<string, any>;
  label?: string;
}): Promise<T> {
  const { client, signer, transactionFactory, options, label } = opts;
  const maxAttempts = envInt('TX_LOCK_RETRY_MAX_ATTEMPTS', 0); // 0 = unlimited

  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const transaction = transactionFactory();
      return (await client.signAndExecuteTransaction({
        signer,
        transaction,
        options,
      } as any)) as T;
    } catch (error) {
      if (!isRetryableSharedObjectError(error)) throw error;
      if (maxAttempts > 0 && attempt >= maxAttempts) throw error;

      const waitMs = randomDelayMs();
      const prefix = label ? `[tx-retry:${label}]` : '[tx-retry]';
      console.warn(`${prefix} retryable shared-object/version conflict, retry ${attempt} in ${waitMs} ms: ${String((error as any)?.message ?? error)}`);
      await sleep(waitMs);
    }
  }
}
