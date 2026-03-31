import { MultiSigPublicKey } from "@iota/iota-sdk/multisig";
import { Ed25519PublicKey } from "@iota/iota-sdk/keypairs/ed25519";
import { sha256 } from "@noble/hashes/sha256";

export type WeightedSigner = {
  pubKeyBase64: string;
  weight?: number;
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  if (!clean || clean.length % 2 !== 0) {
    throw new Error("Invalid hex value");
  }

  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const value = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(value)) throw new Error("Invalid hex value");
    out[i] = value;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function buildMultiSigFromBase64(threshold: number, signers: WeightedSigner[]) {
  return MultiSigPublicKey.fromPublicKeys({
    threshold,
    publicKeys: signers.map((s) => ({
      publicKey: new Ed25519PublicKey(s.pubKeyBase64),
      weight: s.weight ?? 1,
    })),
  });
}

export function deriveAddressFromSignerSet(threshold: number, signers: WeightedSigner[]) {
  return buildMultiSigFromBase64(threshold, signers).toIotaAddress();
}

export function computeResultHash(resultBytes: Uint8Array) {
  return sha256(resultBytes);
}

export function normalizePubkeyToBase64(value: unknown): string {
  if (typeof value === "string") {
    const v = value.trim();
    if (!v) throw new Error("Empty pubkey");
    if (v.startsWith("0x") || /^[0-9a-fA-F]+$/.test(v)) {
      return bytesToBase64(hexToBytes(v));
    }
    return v;
  }

  if (value instanceof Uint8Array) {
    return bytesToBase64(value);
  }

  if (Array.isArray(value)) {
    return bytesToBase64(Uint8Array.from(value as number[]));
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["bytes", "pubkey", "value", "data"]) {
      if (key in obj) return normalizePubkeyToBase64(obj[key]);
    }
  }

  throw new Error("Unsupported pubkey format");
}
