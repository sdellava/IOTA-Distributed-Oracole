import "dotenv/config";
import { iotaClient } from "../iota.js";

type TaskTemplate = {
  templateId: number;
  taskType: string;
  isEnabled: boolean;
  basePriceIota: string | null;
  maxInputBytes: string | null;
  maxOutputBytes: string | null;
  allowStorage: boolean;
};

type PendingProposal = {
  proposalId: number;
  kind: "upsert" | "remove" | "unknown";
  templateId: number;
  approvals: number;
  electorateSize: number;
  approvalsNeeded: number;
  deadlineMs: number;
  deadlineIso: string | null;
} | null;

function parseArgs(argv: string[]) {
  const flags = new Set(argv.slice(2).map((x) => x.trim().toLowerCase()));
  return {
    pending: flags.has("--pending"),
    pendingOnly: flags.has("--pending-only"),
    json: flags.has("--json"),
    help: flags.has("--help") || flags.has("-h"),
  };
}

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

function toNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : 0;
  }
  const record = asRecord(value);
  if (!record) return 0;
  return toNum(record.value);
}

function toStr(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (Array.isArray(value) && value.every((x) => typeof x === "number")) {
    try {
      return new TextDecoder().decode(Uint8Array.from(value as number[]));
    } catch {
      return "";
    }
  }
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.value === "string") return record.value;
  if (Array.isArray(record.bytes) && record.bytes.every((x) => typeof x === "number")) {
    return toStr(record.bytes);
  }
  return "";
}

function toBool(value: unknown): boolean {
  return toNum(value) !== 0;
}

function majorityThreshold(total: number): number {
  if (total <= 0) return 0;
  return Math.floor(total / 2) + 1;
}

async function getStateFields() {
  const stateId = String(process.env.ORACLE_STATE_ID ?? "").trim();
  if (!stateId) throw new Error("Missing env ORACLE_STATE_ID");
  const client = iotaClient();
  const res: any = await client.getObject({
    id: stateId,
    options: { showContent: true },
  });
  const fields = extractFields(res?.data?.content);
  if (!fields) throw new Error("Cannot parse ORACLE_STATE_ID object fields");
  return { client, stateId, fields };
}

async function listTemplateDynamicFields(client: any, stateId: string): Promise<TaskTemplate[]> {
  const out: TaskTemplate[] = [];
  let cursor: string | null | undefined = null;

  for (;;) {
    const page: any = await client.getDynamicFields({ parentId: stateId, cursor, limit: 50 });
    for (const item of page?.data ?? []) {
      const nameType = String(item?.name?.type ?? "");
      if (!nameType.includes("TaskTemplateKey")) continue;
      const objectId = String(item?.objectId ?? "").trim();
      if (!objectId) continue;

      const obj: any = await client.getObject({ id: objectId, options: { showContent: true } });
      const outerFields = extractFields(obj?.data?.content);
      if (!outerFields) continue;
      const valueFields = extractFields(outerFields.value) ?? asRecord(outerFields.value);
      if (!valueFields) continue;

      const templateId = toNum(valueFields.template_id);
      if (!templateId) continue;

      out.push({
        templateId,
        taskType: toStr(valueFields.task_type),
        isEnabled: toBool(valueFields.is_enabled),
        basePriceIota: toStr(valueFields.base_price_iota) || null,
        maxInputBytes: toStr(valueFields.max_input_bytes) || null,
        maxOutputBytes: toStr(valueFields.max_output_bytes) || null,
        allowStorage: toBool(valueFields.allow_storage),
      });
    }

    if (!page?.hasNextPage || !page?.nextCursor) break;
    cursor = page.nextCursor;
  }

  out.sort((a, b) => a.templateId - b.templateId);
  return out;
}

function getPendingProposal(fields: Record<string, unknown>): PendingProposal {
  const active = toNum(fields.template_proposal_active);
  if (active !== 1) return null;

  const proposalId = toNum(fields.template_proposal_id);
  const kindRaw = toNum(fields.template_proposal_kind);
  const kind = kindRaw === 1 ? "upsert" : kindRaw === 2 ? "remove" : "unknown";
  const templateId = toNum(fields.proposed_template_id);
  const approvals = toNum(fields.template_proposal_approvals);
  const electorateSize = toNum(fields.template_proposal_electorate_size);
  const approvalsNeeded = majorityThreshold(electorateSize);
  const deadlineMs = toNum(fields.template_proposal_deadline_ms);

  return {
    proposalId,
    kind,
    templateId,
    approvals,
    electorateSize,
    approvalsNeeded,
    deadlineMs,
    deadlineIso: deadlineMs > 0 ? new Date(deadlineMs).toISOString() : null,
  };
}

function printHelp() {
  console.log(`Usage:
  npm exec tsx src/tools/listTemplates.ts [--pending] [--pending-only] [--json]

Options:
  --pending       Also show the active pending template proposal
  --pending-only  Show only pending proposal details
  --json          Print JSON output
`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const { client, stateId, fields } = await getStateFields();
  const pending = getPendingProposal(fields);
  const approved = await listTemplateDynamicFields(client, stateId);

  const out = {
    stateId,
    approvedTemplates: approved,
    pendingProposal: pending,
  };

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (!args.pendingOnly) {
    console.log(`State: ${stateId}`);
    console.log(`Approved templates: ${approved.length}`);
    for (const t of approved) {
      console.log(
        `- id=${t.templateId} type=${t.taskType || "-"} enabled=${t.isEnabled ? "yes" : "no"} storage=${t.allowStorage ? "yes" : "no"} base=${t.basePriceIota ?? "-"}`,
      );
    }
  }

  if (args.pending || args.pendingOnly) {
    console.log("");
    if (!pending) {
      console.log("Pending proposal: none");
    } else {
      console.log("Pending proposal:");
      console.log(`- proposal_id: ${pending.proposalId}`);
      console.log(`- kind: ${pending.kind}`);
      console.log(`- template_id: ${pending.templateId}`);
      console.log(`- approvals: ${pending.approvals}/${pending.approvalsNeeded} (electorate=${pending.electorateSize})`);
      console.log(`- deadline: ${pending.deadlineIso ?? "-"}`);
    }
  }
}

main().catch((e: any) => {
  console.error(
    JSON.stringify(
      {
        error: "template_list_failed",
        message: e?.message ?? String(e),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

