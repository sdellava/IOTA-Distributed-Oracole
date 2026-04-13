import { MultiSigPublicKey } from "@iota/iota-sdk/multisig";
import { Ed25519PublicKey } from "@iota/iota-sdk/keypairs/ed25519";
import { sha256 } from "@noble/hashes/sha256";

export type WeightedSigner = {
  pubKeyBase64: string;
  weight?: number;
};

export type RegisteredNodeLike = {
  nodeId?: string | number;
  id?: string | number;
  address?: string;
  pubkey?: unknown;
};

export type TaskMultisigLike = {
  multisig_addr?: string | null;
  multisig_bytes?: unknown;
  certificate_signers?: Array<string | number>;
  quorum_k?: number | string;
  result?: unknown;
  result_bytes?: number[] | Uint8Array | string | null;
  result_hash?: number[] | Uint8Array | string | null;
};

export type TaskMultisigValidation = {
  storedAddress: string;
  derivedAddress: string | null;
  addressMatch: boolean;
  addressStatus: "match" | "stored_is_signer" | "mismatch";
  derivedError: string | null;
  signerRows: Array<{
    signerId: string;
    found: boolean;
    address?: string;
    pubkeyBase64?: string;
    error?: string;
  }>;
  resultHashHex: string | null;
  multisigDebug: any;
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

function normalizeId(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeAddress(value: unknown): string {
  const t = String(value ?? "").trim().toLowerCase();
  if (!t) return "";
  return t.startsWith("0x") ? t : `0x${t}`;
}

function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const binary = window.atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value);

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("0x") || /^[0-9a-fA-F]+$/.test(trimmed)) return hexToBytes(trimmed);
    return base64ToBytes(trimmed);
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["bytes", "pubkey", "value", "data", "contents"]) {
      if (key in obj) return toUint8Array(obj[key]);
    }
  }

  return null;
}

function bytesToHex(bytes: Uint8Array | null | undefined): string {
  if (!bytes || bytes.length === 0) return "";
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function decodeAsciiJson(value: unknown): any | null {
  const bytes = toUint8Array(value);
  if (!bytes) return null;

  try {
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch {
    return null;
  }
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

export function validateTaskMultisig(
  task: TaskMultisigLike | null | undefined,
  registeredNodes: RegisteredNodeLike[],
): TaskMultisigValidation {
  if (!task) {
    return {
      storedAddress: "",
      derivedAddress: null,
      addressMatch: false,
      addressStatus: "mismatch",
      derivedError: "No task loaded.",
      signerRows: [],
      resultHashHex: null,
      multisigDebug: null,
    };
  }

  const signerIds = Array.isArray(task.certificate_signers)
    ? task.certificate_signers.map((x) => normalizeId(x)).filter(Boolean)
    : [];

  const thresholdRaw = task.quorum_k;
  const threshold = Number(thresholdRaw);
  const storedAddress = String(task.multisig_addr ?? "").trim();
  const multisigDebug = decodeAsciiJson(task.multisig_bytes);

  const orderedSignerIds =
    multisigDebug && Array.isArray(multisigDebug.signers)
      ? multisigDebug.signers.map((x: unknown) => normalizeId(x)).filter(Boolean)
      : signerIds;

  const signerRows: TaskMultisigValidation["signerRows"] = orderedSignerIds.map((signerId: string) => {
    const signerIdLc = signerId.toLowerCase();
    const node =
      registeredNodes.find((n) => normalizeId(n.address).toLowerCase() === signerIdLc) ??
      registeredNodes.find((n) => normalizeId(n.nodeId).toLowerCase() === signerIdLc) ??
      registeredNodes.find((n) => normalizeId(n.id).toLowerCase() === signerIdLc);

    if (!node) {
      return { signerId, found: false, error: "Registered node not found" };
    }

    try {
      const pubkeyBase64 = normalizePubkeyToBase64(node.pubkey);
      return { signerId, found: true, address: node.address, pubkeyBase64 };
    } catch (error) {
      return {
        signerId,
        found: true,
        address: node.address,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const validSignerPubkeys = signerRows
    .filter((row: TaskMultisigValidation["signerRows"][number]) => !!row.pubkeyBase64)
    .map((row: TaskMultisigValidation["signerRows"][number]) => ({ pubKeyBase64: row.pubkeyBase64 as string, weight: 1 }));

  let derivedAddress: string | null = null;
  let derivedError: string | null = null;

  try {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      derivedError = `Invalid quorum_k on task: ${String(thresholdRaw)}`;
    } else if (validSignerPubkeys.length < threshold) {
      derivedError = `Not enough signer pubkeys to derive multisig. threshold=${threshold}, found=${validSignerPubkeys.length}`;
    } else {
      derivedAddress = deriveAddressFromSignerSet(threshold, validSignerPubkeys);
    }
  } catch (error) {
    derivedError = error instanceof Error ? error.message : String(error);
  }

  const signerAddresses = signerRows
    .map((row: TaskMultisigValidation["signerRows"][number]) => normalizeAddress(row.address))
    .filter(Boolean);
  const normalizedStoredAddress = normalizeAddress(storedAddress);
  const normalizedDerivedAddress = normalizeAddress(derivedAddress);
  const storedMatchesSigner =
    !!normalizedStoredAddress && signerAddresses.some((addr: string) => addr === normalizedStoredAddress);

  let addressStatus: "match" | "stored_is_signer" | "mismatch" = "mismatch";
  if (normalizedStoredAddress && normalizedDerivedAddress && normalizedStoredAddress === normalizedDerivedAddress) {
    addressStatus = "match";
  } else if (storedMatchesSigner) {
    addressStatus = "stored_is_signer";
  }

  const resultHashBytes =
    toUint8Array(task.result_hash) ??
    (() => {
      const resultBytes = toUint8Array(task.result_bytes ?? task.result);
      return resultBytes ? computeResultHash(resultBytes) : null;
    })();

  return {
    storedAddress,
    derivedAddress,
    addressMatch:
      !!normalizedStoredAddress && !!normalizedDerivedAddress && normalizedStoredAddress === normalizedDerivedAddress,
    addressStatus,
    derivedError,
    signerRows,
    resultHashHex: resultHashBytes ? bytesToHex(resultHashBytes) : null,
    multisigDebug,
  };
}
