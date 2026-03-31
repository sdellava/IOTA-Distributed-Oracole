export function getMoveFields(obj: any): Record<string, any> {
  const c: any = obj?.data?.content;
  if (!c || c.dataType !== "moveObject") return {};
  return (c.fields ?? {}) as Record<string, any>;
}

export function normalizeEd25519Raw32(pkBytes: Uint8Array): Uint8Array {
  if (pkBytes.length === 32) return pkBytes;
  if (pkBytes.length === 33) return pkBytes.slice(1);
  if (pkBytes.length > 32) return pkBytes.slice(pkBytes.length - 32);
  return pkBytes;
}
