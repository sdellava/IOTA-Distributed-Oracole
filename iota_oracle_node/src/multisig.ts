import { MultiSigPublicKey } from "@iota/iota-sdk/multisig";
import { Ed25519PublicKey } from "@iota/iota-sdk/keypairs/ed25519";

/**
 * Deterministic message signed by nodes for oracle consensus.
 *
 * Include round to avoid accidental cross-round reuse when mediation starts a new round
 * on the same Task ID.
 */
export function buildConsensusMessage(taskId: string, round: number, consensusHashHex: string): Uint8Array {
  const s = `oracle:v2|taskId=${taskId}|round=${round}|hash=${consensusHashHex}`;
  return new TextEncoder().encode(s);
}

/**
 * Deterministic message for commit signature (commit barrier phase).
 * The commit signature is a personal-message signature by the node.
 *
 * This is not verified on-chain; it exists to allow off-chain audit and to enforce the
 * commit-before-reveal ordering inside the protocol.
 */
export function buildCommitMessage(taskId: string, round: number, consensusHashHex: string): Uint8Array {
  const s = `oracle:commit:v1|taskId=${taskId}|round=${round}|hash=${consensusHashHex}`;
  return new TextEncoder().encode(s);
}

export function buildMultiSigPublicKey(threshold: number, pubs: Array<{ nodeId: string; pubKeyBase64: string }>) {
  return MultiSigPublicKey.fromPublicKeys({
    threshold,
    publicKeys: pubs.map((p) => ({ publicKey: new Ed25519PublicKey(p.pubKeyBase64), weight: 1 })),
  });
}

export function deriveCommitteeMultisigAddress(
  threshold: number,
  pubs: Array<{ nodeId: string; pubKeyBase64: string }>,
): string {
  return buildMultiSigPublicKey(threshold, pubs).toIotaAddress();
}

export function assertCommitteeMultisigAddress(args: {
  threshold: number;
  pubs: Array<{ nodeId: string; pubKeyBase64: string }>;
  multisigAddr: string;
  context: string;
}): string {
  const derived = deriveCommitteeMultisigAddress(args.threshold, args.pubs);
  if (derived.toLowerCase() !== args.multisigAddr.toLowerCase()) {
    throw new Error(
      `[${args.context}] reject finalize: derived committee multisig address ${derived} != provided ${args.multisigAddr}`,
    );
  }
  return derived;
}
