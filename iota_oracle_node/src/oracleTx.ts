import fs from "node:fs";
import type { IotaClient } from "@iota/iota-sdk/client";
import { Transaction } from "@iota/iota-sdk/transactions";
import { decodeIotaPrivateKey } from "@iota/iota-sdk/cryptography";
import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";

import { bcsVecU8, bcsAddress, bcsVecU64, bcsU64 } from "./bcs";
import { parseAcceptedTemplateIds } from "./nodeConfig";
import { signAndExecuteWithLockRetry } from "./txRetry.js";

function mustEnv(key: string): string {
  const v = process.env[key]?.trim();
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function optEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function getSystemPackageId(): string {
  return (
    process.env.ORACLE_SYSTEM_PACKAGE_ID?.trim() ||
    process.env.ORACLE_PACKAGE_ID?.trim() ||
    mustEnv("ORACLE_PACKAGE_ID")
  );
}

function getStateId(): string {
  return (
    process.env.ORACLE_STATE_ID?.trim() ||
    process.env.ORACLE_STATUS_ID?.trim() ||
    process.env.ORACLE_SYSTEM_STATE_ID?.trim() ||
    mustEnv("ORACLE_STATE_ID")
  );
}


function getClockId(): string {
  return (process.env.IOTA_CLOCK_ID?.trim() || "0x6").trim() || "0x6";
}

function isDevLikeNetwork(networkRaw: string | undefined): boolean {
  const network = String(networkRaw ?? "").trim().toLowerCase();
  return network === "" || network === "dev" || network === "devnet" || network === "local" || network === "localnet";
}

function resolveRegisterMode(): "off" | "dev" | "prod" {
  const raw = String(process.env.REGISTER_MODE ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0") return "off";
  const networkIsDevLike = isDevLikeNetwork(process.env.IOTA_NETWORK);

  if (raw === "dev") {
    // Safety rule: non-dev networks cannot use dev registration mode.
    return networkIsDevLike ? "dev" : "prod";
  }
  if (raw === "prod") return "prod";

  // Default inference by network:
  // - dev/devnet/local/localnet -> dev registration (no controller cap required)
  // - all other networks         -> prod registration (validator/controller cap required)
  return networkIsDevLike ? "dev" : "prod";
}

function gasBudget(envKey: string, def: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${envKey}: ${raw}`);
  return Math.floor(n);
}

function loadValidatorKeypairOrNull(): Ed25519Keypair | null {
  const fp = optEnv("VALIDATOR_KEY_FILE") || optEnv("ORACLE_CONTROLLER_KEY_FILE");
  const inline = optEnv("VALIDATOR_IOTAPRIVKEY") || optEnv("ORACLE_CONTROLLER_IOTAPRIVKEY");

  let secret: string | undefined;
  if (fp) {
    secret = fs.readFileSync(fp, "utf8").trim();
  } else if (inline) {
    secret = inline;
  }

  if (!secret) return null;

  const parsed = decodeIotaPrivateKey(secret);
  if (parsed.schema !== "ED25519") throw new Error(`Validator key schema not supported: ${parsed.schema}`);
  return Ed25519Keypair.fromSecretKey(parsed.secretKey);
}

async function findOwnedValidatorCapId(client: IotaClient, owner: string): Promise<string | null> {
  let cursor: string | null | undefined = null;
  const found: string[] = [];

  for (;;) {
    const page: any = await client.getOwnedObjects({
      owner,
      cursor,
      limit: 50,
      options: { showType: true },
    });

    for (const item of page?.data ?? []) {
      const objectId = String(item?.data?.objectId ?? item?.objectId ?? "").trim();
      const typ = String(item?.data?.type ?? item?.type ?? "").trim();
      if (!objectId || !typ) continue;
      if (typ.includes("validator_cap::UnverifiedValidatorOperationCap")) {
        found.push(objectId);
      }
    }

    if (!page?.hasNextPage || !page?.nextCursor) break;
    cursor = page.nextCursor;
  }

  if (found.length === 0) return null;
  found.sort();
  return found[0]!;
}

async function readObjectTypeAndOwner(
  client: IotaClient,
  objectId: string,
): Promise<{ type: string; ownerAddress: string | null }> {
  const obj: any = await client.getObject({
    id: objectId,
    options: { showType: true, showOwner: true },
  });
  const type = String(obj?.data?.type ?? "");
  const ownerRaw: any = obj?.data?.owner;
  const ownerAddress =
    typeof ownerRaw?.AddressOwner === "string"
      ? String(ownerRaw.AddressOwner).toLowerCase()
      : null;
  return { type, ownerAddress };
}

export async function registerOracleNode(opts: {
  client: IotaClient;
  oracleKeypair: Ed25519Keypair;
  oracleAddr: string;
  oraclePubkeyRaw32: Uint8Array;
  acceptedTemplateIds?: number[];
}): Promise<string> {
  const { client, oracleKeypair, oracleAddr, oraclePubkeyRaw32 } = opts;

  const pkg = getSystemPackageId();
  const stateId = getStateId();
  const acceptedTemplateIds = (opts.acceptedTemplateIds?.length ? [...opts.acceptedTemplateIds] : parseAcceptedTemplateIds())
    .map((n) => Math.floor(Number(n)))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (acceptedTemplateIds.length === 0) {
    throw new Error("acceptedTemplateIds cannot be empty");
  }

  const mode = resolveRegisterMode();
  if (mode === "off") return "";

  if (mode === "prod") {
    const signer = loadValidatorKeypairOrNull() ?? oracleKeypair;
    const signerAddress = signer.getPublicKey().toIotaAddress().toLowerCase();
    const validatorCapTypeMarker = "validator_cap::UnverifiedValidatorOperationCap";

    let validatorCapId: string | undefined;
    const explicitValidatorCap = optEnv("VALIDATOR_CAP_ID");
    if (explicitValidatorCap) {
      validatorCapId = explicitValidatorCap;
    } else {
      // Backward-compatible alias. This is accepted only if it is actually a validator cap object.
      const legacyCap = optEnv("ORACLE_CONTROLLER_CAP_ID");
      if (legacyCap) {
        const legacyInfo = await readObjectTypeAndOwner(client, legacyCap);
        if (legacyInfo.type.includes(validatorCapTypeMarker)) {
          validatorCapId = legacyCap;
        }
      }
    }

    if (!validatorCapId) {
      validatorCapId = (await findOwnedValidatorCapId(client, signerAddress)) ?? undefined;
    }
    if (!validatorCapId) {
      throw new Error(
        `Prod registration requires UnverifiedValidatorOperationCap owned by signer ${signerAddress}. Set VALIDATOR_CAP_ID or use a signer that owns a validator cap.`,
      );
    }

    const capInfo = await readObjectTypeAndOwner(client, validatorCapId);
    if (!capInfo.type.includes(validatorCapTypeMarker)) {
      throw new Error(
        `Object ${validatorCapId} is not UnverifiedValidatorOperationCap (type=${capInfo.type || "unknown"}).`,
      );
    }
    if (capInfo.ownerAddress && capInfo.ownerAddress !== signerAddress) {
      const autoOwnedCapId = await findOwnedValidatorCapId(client, signerAddress);
      if (autoOwnedCapId && autoOwnedCapId !== validatorCapId) {
        validatorCapId = autoOwnedCapId;
      } else {
        throw new Error(
          `Validator cap ${validatorCapId} is owned by ${capInfo.ownerAddress}, but signer is ${signerAddress}.`,
        );
      }
    }

    const systemId = (process.env.IOTA_SYSTEM_STATE_ID ?? "0x5").trim() || "0x5";

    const res = await signAndExecuteWithLockRetry({
      client,
      signer,
      transactionFactory: () => {
        const tx = new Transaction();
        tx.setGasBudget(gasBudget("GAS_BUDGET_REGISTER", gasBudget("GAS_BUDGET", 30_000_000)));
        tx.moveCall({
          target: `${pkg}::systemState::register_oracle_node`,
          arguments: [
            tx.object(stateId),
            tx.object(systemId),
            tx.object(validatorCapId),
            tx.pure(bcsAddress(oracleAddr)),
            tx.pure(bcsVecU8(oraclePubkeyRaw32)),
            tx.pure(bcsVecU64(acceptedTemplateIds)),
          ],
        });
        return tx;
      },
      options: { showEffects: true, showObjectChanges: true },
      label: "register_oracle_node",
    });

    await client.waitForTransaction({ digest: res.digest });
    return res.digest as string;
  }

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: oracleKeypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(gasBudget("GAS_BUDGET_REGISTER", gasBudget("GAS_BUDGET", 20_000_000)));
      tx.moveCall({
        target: `${pkg}::systemState::register_oracle_node_dev`,
        arguments: [
          tx.object(stateId),
          tx.pure(bcsAddress(oracleAddr)),
          tx.pure(bcsVecU8(oraclePubkeyRaw32)),
          tx.pure(bcsVecU64(acceptedTemplateIds)),
        ],
      });
      return tx;
    },
    options: { showEffects: true, showObjectChanges: true },
    label: "register_oracle_node_dev",
  });

  await client.waitForTransaction({ digest: res.digest });
  return res.digest as string;
}

export async function unregisterOracleNode(opts: { client: IotaClient; keypair: Ed25519Keypair }): Promise<string> {
  const { client, keypair } = opts;
  const pkg = getSystemPackageId();
  const stateId = getStateId();

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(gasBudget("GAS_BUDGET_UNREGISTER", gasBudget("GAS_BUDGET", 20_000_000)));
      tx.moveCall({
        target: `${pkg}::systemState::unregister_oracle_node`,
        arguments: [tx.object(stateId)],
      });
      return tx;
    },
    options: { showEffects: true, showObjectChanges: true },
    label: "unregister_oracle_node",
  });

  await client.waitForTransaction({ digest: res.digest });
  return res.digest as string;
}


export async function approveTaskTemplateProposal(opts: {
  client: IotaClient;
  keypair: Ed25519Keypair;
  proposalId?: number;
  expectedTemplateId?: number;
}): Promise<string> {
  const { client, keypair, proposalId, expectedTemplateId } = opts;
  const pkg = getSystemPackageId();
  const stateId = getStateId();
  const clockId = getClockId();
  const resolvedProposalId = await resolvePendingTemplateProposalId(client, stateId, {
    proposalId,
    expectedTemplateId,
  });

  const res = await signAndExecuteWithLockRetry({
    client,
    signer: keypair,
    transactionFactory: () => {
      const tx = new Transaction();
      tx.setGasBudget(gasBudget("GAS_BUDGET_TEMPLATE_PROPOSAL_APPROVE", gasBudget("GAS_BUDGET", 20_000_000)));
      tx.moveCall({
        target: `${pkg}::systemState::approve_task_template_proposal`,
        arguments: [tx.object(stateId), tx.object(clockId), tx.pure(bcsU64(resolvedProposalId))],
      });
      return tx;
    },
    options: { showEffects: true, showEvents: true, showObjectChanges: true },
    label: "approve_task_template_proposal",
  });

  await client.waitForTransaction({ digest: res.digest });
  return res.digest as string;
}

type PendingTemplateProposal = {
  proposalId: number;
  templateId: number;
  kind: number;
  approvals: number;
  electorateSize: number;
  deadlineMs: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function extractFields(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  const fields = asRecord(record.fields);
  if (fields) return fields;
  const content = asRecord(record.content);
  if (content) return extractFields(content);
  const nestedValue = asRecord(record.value);
  if (nestedValue) return nestedValue;
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  return toNumber(record.value);
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["items", "contents", "vec", "value"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function parsePendingTemplateProposals(stateFields: Record<string, unknown>): PendingTemplateProposal[] {
  const raw = toArray(stateFields.template_proposals);
  const out: PendingTemplateProposal[] = [];

  for (const item of raw) {
    const fields = extractFields(item) ?? asRecord(item) ?? {};
    const proposalId = toNumber(fields.proposal_id);
    const templateId = toNumber(fields.template_id);
    if (proposalId == null || proposalId <= 0 || templateId == null || templateId <= 0) continue;
    out.push({
      proposalId,
      templateId,
      kind: toNumber(fields.proposal_kind) ?? 0,
      approvals: toNumber(fields.approvals) ?? 0,
      electorateSize: toNumber(fields.electorate_size) ?? 0,
      deadlineMs: toNumber(fields.deadline_ms) ?? 0,
    });
  }

  out.sort((a, b) => a.proposalId - b.proposalId);
  if (out.length > 0) return out;

  // Backward compatibility with single-proposal state layout.
  const active = toNumber(stateFields.template_proposal_active);
  if (active === 1) {
    const proposalId = toNumber(stateFields.template_proposal_id);
    const templateId = toNumber(stateFields.proposed_template_id);
    if (proposalId != null && proposalId > 0 && templateId != null && templateId > 0) {
      out.push({
        proposalId,
        templateId,
        kind: toNumber(stateFields.template_proposal_kind) ?? 0,
        approvals: toNumber(stateFields.template_proposal_approvals) ?? 0,
        electorateSize: toNumber(stateFields.template_proposal_electorate_size) ?? 0,
        deadlineMs: toNumber(stateFields.template_proposal_deadline_ms) ?? 0,
      });
    }
  }
  return out;
}

async function resolvePendingTemplateProposalId(
  client: IotaClient,
  stateId: string,
  opts: { proposalId?: number; expectedTemplateId?: number },
): Promise<number> {
  const response: any = await client.getObject({
    id: stateId,
    options: { showContent: true },
  });
  const stateFields = extractFields(response?.data?.content);
  if (!stateFields) {
    throw new Error("Cannot parse oracle state object fields");
  }
  const proposals = parsePendingTemplateProposals(stateFields);
  if (proposals.length === 0) {
    throw new Error("No active template proposal on-chain");
  }

  if (opts.proposalId != null) {
    const exact = proposals.find((p) => p.proposalId === opts.proposalId);
    if (!exact) {
      throw new Error(`Pending proposal_id=${opts.proposalId} not found on-chain`);
    }
    if (opts.expectedTemplateId != null && exact.templateId !== opts.expectedTemplateId) {
      throw new Error(
        `Proposal mismatch: proposal_id=${opts.proposalId} has template_id=${exact.templateId}, expected ${opts.expectedTemplateId}`,
      );
    }
    return exact.proposalId;
  }

  if (opts.expectedTemplateId != null) {
    const matches = proposals.filter((p) => p.templateId === opts.expectedTemplateId);
    if (matches.length === 0) {
      throw new Error(`No active template proposal on-chain for template_id=${opts.expectedTemplateId}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple pending proposals for template_id=${opts.expectedTemplateId}. Pass --proposal-id explicitly.`,
      );
    }
    return matches[0]!.proposalId;
  }

  if (proposals.length > 1) {
    throw new Error(`Multiple pending proposals found (${proposals.length}). Pass --proposal-id or --template-id.`);
  }
  return proposals[0]!.proposalId;
}
