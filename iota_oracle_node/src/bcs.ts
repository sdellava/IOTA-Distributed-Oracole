import { bcs } from "@iota/iota-sdk/bcs";

export function bcsVecU8(bytes: Uint8Array): Uint8Array {
  return bcs.vector(bcs.u8()).serialize(Array.from(bytes)).toBytes();
}

export function bcsVecU64(values: Array<number | string | bigint>): Uint8Array {
  return bcs
    .vector(bcs.u64())
    .serialize(values as any)
    .toBytes();
}

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bcsAddress(addr: string): Uint8Array {
  return bcs.Address.serialize(addr).toBytes();
}

export function bcsU8(n: number): Uint8Array {
  return bcs.u8().serialize(n).toBytes();
}

export function bcsU64(n: number | string | bigint): Uint8Array {
  return bcs
    .u64()
    .serialize(n as any)
    .toBytes();
}

export function bcsVecAddress(addrs: string[]): Uint8Array {
  return bcs.vector(bcs.Address).serialize(addrs as any).toBytes();
}
