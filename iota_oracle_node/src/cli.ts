// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { iotaClient } from "./iota.js";
import { loadOrCreateNodeIdentity } from "./keys.js";
import { approveTaskTemplateProposal, registerOracleNode } from "./oracleTx.js";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") continue;
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith("--")) {
        args[k] = v;
        i++;
      } else {
        args[k] = "true";
      }
    }
  }
  return args;
}

function readCommand(argv: string[]): string {
  const cmd = argv[2];
  if (!cmd || cmd.startsWith("--")) return "help";
  return cmd.trim().toLowerCase();
}

function printHelp() {
  console.log(`Usage:
  npm run cli -- show-node-address --node 1
  npm run cli -- accept-template-proposal --node 1 [--proposal-id 12] [--template-id 4]
  npm run cli -- set-accepted-templates --node 1 --templates 1,2,3,4,5,6,7`);
}

async function cmdAcceptTemplateProposal(argv: string[]) {
  const args = parseArgs(argv);
  const nodeId = String(args.node ?? process.env.NODE_ID ?? "1").trim();
  if (!/^[0-9]+$/.test(nodeId)) throw new Error(`--node must be numeric (got "${nodeId}")`);

  const templateIdRaw = String(args["template-id"] ?? args.templateId ?? "").trim();
  const expectedTemplateId = templateIdRaw.length > 0 ? Number(templateIdRaw) : undefined;
  if (templateIdRaw.length > 0 && (!Number.isInteger(expectedTemplateId) || Number(expectedTemplateId) <= 0)) {
    throw new Error(`--template-id must be a positive integer (got "${templateIdRaw}")`);
  }
  const proposalIdRaw = String(args["proposal-id"] ?? args.proposalId ?? "").trim();
  const proposalId = proposalIdRaw.length > 0 ? Number(proposalIdRaw) : undefined;
  if (proposalIdRaw.length > 0 && (!Number.isInteger(proposalId) || Number(proposalId) <= 0)) {
    throw new Error(`--proposal-id must be a positive integer (got "${proposalIdRaw}")`);
  }

  const client = iotaClient();
  const identity = loadOrCreateNodeIdentity(nodeId);
  const digest = await approveTaskTemplateProposal({
    client,
    keypair: identity.keypair,
    proposalId,
    expectedTemplateId,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        command: "accept-template-proposal",
        nodeId,
        address: identity.address,
        proposalId: proposalId ?? null,
        expectedTemplateId: expectedTemplateId ?? null,
        digest,
      },
      null,
      2,
    ),
  );
}

function parseTemplateIdsArg(raw: string | undefined): number[] {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error("Missing --templates 1,2,3,4,...");

  const out: number[] = [];
  for (const part of value.split(/[;,\s]+/)) {
    const s = part.trim();
    if (!s) continue;
    const n = Number(s);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid template id: ${s}`);
    }
    if (!out.includes(n)) out.push(n);
  }

  if (out.length === 0) throw new Error("No valid template ids provided");
  out.sort((a, b) => a - b);
  return out;
}

async function cmdSetAcceptedTemplates(argv: string[]) {
  const args = parseArgs(argv);
  const nodeId = String(args.node ?? process.env.NODE_ID ?? "1").trim();
  if (!/^[0-9]+$/.test(nodeId)) throw new Error(`--node must be numeric (got "${nodeId}")`);

  const acceptedTemplateIds = parseTemplateIdsArg(args.templates);
  const client = iotaClient();
  const identity = loadOrCreateNodeIdentity(nodeId);

  const digest = await registerOracleNode({
    client,
    oracleKeypair: identity.keypair,
    oracleAddr: identity.address,
    oraclePubkeyRaw32: identity.publicKeyBytes,
    acceptedTemplateIds,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        command: "set-accepted-templates",
        nodeId,
        address: identity.address,
        acceptedTemplateIds,
        digest,
        note: "The on-chain accepted_template_ids vector is replaced entirely by this command.",
      },
      null,
      2,
    ),
  );
}

async function cmdShowNodeAddress(argv: string[]) {
  const args = parseArgs(argv);
  const nodeId = String(args.node ?? process.env.NODE_ID ?? "1").trim();
  if (!/^[0-9]+$/.test(nodeId)) throw new Error(`--node must be numeric (got "${nodeId}")`);

  const identity = loadOrCreateNodeIdentity(nodeId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        command: "show-node-address",
        nodeId,
        address: identity.address,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const command = readCommand(process.argv);
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "show-node-address") return cmdShowNodeAddress(process.argv);
  if (command === "accept-template-proposal") return cmdAcceptTemplateProposal(process.argv);
  if (command === "set-accepted-templates") return cmdSetAcceptedTemplates(process.argv);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((e) => {
  const err = e as any;
  console.error(
    JSON.stringify(
      {
        error: "tool_failed",
        message: err?.message ?? String(err),
        cause: err?.cause ? String(err.cause) : undefined,
        stack: err?.stack ? String(err.stack) : undefined,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
