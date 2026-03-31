import { bcs } from '@iota/iota-sdk/bcs';

export function bcsVecU8(bytes: Uint8Array): Uint8Array {
  return bcs.vector(bcs.u8()).serialize(Array.from(bytes)).toBytes();
}

export function bcsU64(n: number | bigint): Uint8Array {
  // JS numbers are safe up to 2^53-1. For larger values pass a bigint.
  const v = typeof n === 'bigint' ? n : BigInt(n);
  return bcs.u64().serialize(v).toBytes();
}

export function bcsU8(n: number): Uint8Array {
  if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error(`bcsU8 out of range: ${n}`);
  return bcs.u8().serialize(n).toBytes();
}

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
