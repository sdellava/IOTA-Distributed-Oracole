// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

// src/events.ts (client)

export function decodeVecU8(v: any): Uint8Array {
  if (v == null) return new Uint8Array();
  if (v instanceof Uint8Array) return v;

  if (Array.isArray(v)) return Uint8Array.from(v.map((n) => Number(n) & 0xff));

  if (typeof v === "object") {
    const o: any = v;
    if (Array.isArray(o.bytes)) return Uint8Array.from(o.bytes.map((n: any) => Number(n) & 0xff));
    if (o.value != null) return decodeVecU8(o.value);
    if (o.fields != null) return decodeVecU8(o.fields);
    if (o.data != null) return decodeVecU8(o.data);
  }

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return new Uint8Array();
    if (s.startsWith("0x")) {
      try {
        return Uint8Array.from(Buffer.from(s.slice(2), "hex"));
      } catch {
        return new Uint8Array();
      }
    }
    try {
      return Uint8Array.from(Buffer.from(s, "base64"));
    } catch {
      return new Uint8Array();
    }
  }

  return new Uint8Array();
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
