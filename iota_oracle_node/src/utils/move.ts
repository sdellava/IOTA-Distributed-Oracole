// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

export function getMoveFields(obj: any): Record<string, any> {
  const c: any = obj?.data?.content;
  if (!c || c.dataType !== "moveObject") return {};
  return (c.fields ?? {}) as Record<string, any>;
}

export function moveToArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["items", "contents", "vec", "value", "fields", "data"]) {
    const nested = (value as any)[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

export function moveToString(value: any): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (!value || typeof value !== "object") return "";
  for (const key of ["value", "id", "objectId", "bytes", "address"]) {
    const nested = (value as any)[key];
    if (typeof nested === "string" || typeof nested === "number" || typeof nested === "bigint") {
      return String(nested);
    }
  }
  if ((value as any).fields) return moveToString((value as any).fields);
  if ((value as any).data) return moveToString((value as any).data);
  return "";
}

export function normalizeEd25519Raw32(pkBytes: Uint8Array): Uint8Array {
  if (pkBytes.length === 32) return pkBytes;
  if (pkBytes.length === 33) return pkBytes.slice(1);
  if (pkBytes.length > 32) return pkBytes.slice(pkBytes.length - 32);
  return pkBytes;
}
