import { Ed25519PublicKey } from "@iota/iota-sdk/keypairs/ed25519";

/**
 * Oracle config may store pubkeys in different encodings:
 * - 32 bytes: raw ed25519 public key
 * - 33 bytes: 1-byte scheme flag (often 0x00 for ed25519) + 32 bytes key
 *
 * Normalize to 32-byte raw key and (when possible) pick the variant that
 * derives the expected IOTA address.
 */
export function normalizeEd25519PubkeyBytesForAddr(pkBytes: Uint8Array, expectedAddr: string): Uint8Array | null {
  const want = String(expectedAddr ?? "").toLowerCase();
  const candidates: Uint8Array[] = [];

  if (pkBytes?.length === 32) candidates.push(pkBytes);
  if (pkBytes?.length === 33) {
    // Most common: [schemeFlag, ...raw32]
    candidates.push(pkBytes.slice(1));
  }
  if (pkBytes?.length > 33) {
    // Last-resort: take the last 32 bytes
    candidates.push(pkBytes.slice(pkBytes.length - 32));
  }

  for (const cand of candidates) {
    if (cand.length !== 32) continue;
    try {
      const pkB64 = Buffer.from(cand).toString("base64");
      const derived = new Ed25519PublicKey(pkB64).toIotaAddress().toLowerCase();
      if (!want || derived === want) return cand;
    } catch {
      // ignore
    }
  }

  // Fallbacks when we cannot derive/compare.
  if (pkBytes?.length === 33) return pkBytes.slice(1);
  if (pkBytes?.length === 32) return pkBytes;
  return null;
}
