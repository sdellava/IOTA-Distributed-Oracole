import { IotaClient } from "@iota/iota-sdk/client";
import { config, getRuntimeConfig } from "../config.js";
import type {
  NodeActivity,
  OracleEventItem,
  OracleStatusResponse,
  OracleTemplateCost,
  RegisteredOracleNode,
} from "../types.js";

type RpcEvent = {
  id?: { txDigest?: string; eventSeq?: string };
  sender?: string;
  transactionModule?: string;
  type?: string;
  parsedJson?: unknown;
  timestampMs?: string;
};

type RpcObjectResponse = {
  data?: {
    content?: unknown;
  };
};

type RpcDynamicFieldPage = {
  data?: Array<{
    objectId?: string;
    objectType?: string;
    name?: {
      type?: string;
      value?: unknown;
    };
  }>;
  hasNextPage?: boolean;
  nextCursor?: string | null;
};

function normalizeAddress(value: string): string {
  const t = String(value ?? "").trim().toLowerCase();
  if (!t) return "";
  return t.startsWith("0x") ? t : `0x${t}`;
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

function toU64String(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.value === "string") return record.value;
  if (typeof record.value === "number" || typeof record.value === "bigint") return String(record.value);
  if (typeof record.id === "string") return record.id;
  return null;
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== 0n;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    return t === "1" || t === "true" || t === "yes";
  }
  return false;
}

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    try {
      return new TextDecoder().decode(Uint8Array.from(value as number[]));
    } catch {
      return String(value);
    }
  }
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.value === "string") return record.value;
  if (Array.isArray(record.bytes) && record.bytes.every((item) => typeof item === "number")) {
    return toText(record.bytes);
  }
  return "";
}

function toByteArray(value: unknown): number[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) return value as number[];
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["bytes", "value", "data", "contents"]) {
    const nested = record[key];
    if (Array.isArray(nested) && nested.every((item) => typeof item === "number")) return nested as number[];
  }
  return [];
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["items", "contents", "vec", "value"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested.map((item) => String(item));
  }
  return [];
}

function normalizeEvent(moduleName: string, event: RpcEvent): OracleEventItem {
  return {
    txDigest: event.id?.txDigest ?? "",
    eventSeq: event.id?.eventSeq ?? "",
    sender: normalizeAddress(event.sender ?? ""),
    module: event.transactionModule ?? moduleName,
    eventType: event.type ?? "",
    timestampMs: event.timestampMs ?? null,
    parsedJson: event.parsedJson ?? null,
  };
}

async function queryModuleEvents(
  client: IotaClient,
  packageId: string,
  moduleName: string,
  eventFetchLimit: number,
): Promise<OracleEventItem[]> {
  if (!packageId) return [];
  const page = await client.queryEvents({
    query: { MoveModule: { package: packageId, module: moduleName } },
    limit: eventFetchLimit,
  });
  return (page.data ?? []).map((event) => normalizeEvent(moduleName, event as RpcEvent));
}

async function getStateObjectContent(client: IotaClient, stateId: string, warnings: string[]): Promise<unknown | null> {
  try {
    const response = (await client.getObject({ id: stateId, options: { showContent: true } })) as RpcObjectResponse;
    return response?.data?.content ?? null;
  } catch (error) {
    warnings.push(`Unable to read oracle system state: ${String(error)}`);
    return null;
  }
}

function parseRegisteredNodes(content: unknown): RegisteredOracleNode[] {
  const stateFields = extractFields(content) ?? {};
  const oracleNodes = Array.isArray(stateFields.oracle_nodes) ? stateFields.oracle_nodes : [];

  const out: RegisteredOracleNode[] = [];
  for (const node of oracleNodes) {
    const fields = extractFields(node) ?? asRecord(node) ?? {};
    const address = normalizeAddress(String(fields.addr ?? (fields.addr as any)?.value ?? ""));
    if (!address) continue;
    const pubkey = fields.pubkey ?? null;
    const acceptedTemplateIds = toStringArray(fields.accepted_template_ids ?? fields.supported_template_ids);
    out.push({
      address,
      pubkey,
      pubkeyBytes: toByteArray(pubkey).length,
      acceptedTemplateIds,
    });
  }

  return out.sort((a, b) => a.address.localeCompare(b.address));
}

function formatAcceptedTasks(
  acceptedTemplateIds: string[],
  _templates: OracleTemplateCost[],
): string[] {
  return acceptedTemplateIds.map((templateId) => String(templateId));
}

function toNodeActivity(
  events: OracleEventItem[],
  activeThresholdMs: number,
  registeredNodes: RegisteredOracleNode[],
): NodeActivity[] {
  const map = new Map<string, NodeActivity>();
  const allowed = new Set(registeredNodes.map((node) => normalizeAddress(node.address)).filter(Boolean));
  const restrictToRegistered = allowed.size > 0;

  for (const node of registeredNodes) {
    const address = normalizeAddress(node.address);
    if (!address) continue;
    map.set(address, {
      sender: address,
      acceptedTasks: [],
      lastSeenMs: null,
      active: false,
    });
  }

  for (const event of events) {
    const sender = normalizeAddress(event.sender);
    if (!sender) continue;
    if (restrictToRegistered && !allowed.has(sender)) continue;

    const existing = map.get(sender);
    const candidateTs = event.timestampMs ?? null;
    const existingTs = existing?.lastSeenMs ?? null;
    const latestTs = Number(candidateTs ?? "0") >= Number(existingTs ?? "0") ? candidateTs : existingTs;
    const active = Number(latestTs ?? "0") >= activeThresholdMs;

    map.set(sender, {
      sender,
      acceptedTasks: existing?.acceptedTasks ?? [],
      lastSeenMs: latestTs,
      active,
    });
  }

  return [...map.values()].sort(
    (a, b) =>
      Number(b.lastSeenMs ?? "0") - Number(a.lastSeenMs ?? "0") ||
      b.acceptedTasks.length - a.acceptedTasks.length ||
      a.sender.localeCompare(b.sender),
  );
}

async function listDynamicFields(
  client: IotaClient,
  parentId: string,
  warnings: string[],
): Promise<NonNullable<RpcDynamicFieldPage["data"]>> {
  const out: NonNullable<RpcDynamicFieldPage["data"]> = [];
  let cursor: string | null | undefined = null;
  try {
    for (;;) {
      const page = (await (client as any).getDynamicFields({ parentId, cursor, limit: 50 })) as RpcDynamicFieldPage;
      out.push(...(page.data ?? []));
      if (!page.hasNextPage) break;
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  } catch (error) {
    warnings.push(`Unable to read state dynamic fields: ${String(error)}`);
  }
  return out;
}

function parseTaskTemplate(dynamicFieldContent: unknown): OracleTemplateCost | null {
  const outerFields = extractFields(dynamicFieldContent);
  if (!outerFields) return null;
  const valueFields = extractFields(outerFields.value) ?? asRecord(outerFields.value);
  if (!valueFields) return null;
  const templateId = toU64String(valueFields.template_id);
  if (!templateId) return null;
  return {
    templateId,
    taskType: toText(valueFields.task_type),
    isEnabled: toBool(valueFields.is_enabled),
    basePriceIota: toU64String(valueFields.base_price_iota),
    maxInputBytes: toU64String(valueFields.max_input_bytes),
    maxOutputBytes: toU64String(valueFields.max_output_bytes),
    includedDownloadBytes: toU64String(valueFields.included_download_bytes),
    pricePerDownloadByteIota: toU64String(valueFields.price_per_download_byte_iota),
    allowStorage: toBool(valueFields.allow_storage),
    minRetentionDays: toU64String(valueFields.min_retention_days),
    maxRetentionDays: toU64String(valueFields.max_retention_days),
    pricePerRetentionDayIota: toU64String(valueFields.price_per_retention_day_iota),
  };
}

async function getConfiguredCosts(client: IotaClient, stateId: string, warnings: string[]) {
  const empty = { systemFeeBps: null, minPayment: null, templates: [] as OracleTemplateCost[] };
  if (!stateId) return empty;
  const content = await getStateObjectContent(client, stateId, warnings);
  if (!content) return empty;
  const stateFields = extractFields(content);
  if (!stateFields) {
    warnings.push("Unable to parse oracle system state fields.");
    return empty;
  }
  const dynamicFields = await listDynamicFields(client, stateId, warnings);
  const templateFields = dynamicFields.filter((item) => String(item.name?.type ?? "").includes("TaskTemplateKey"));
  const templates: OracleTemplateCost[] = [];
  for (const field of templateFields) {
    if (!field.objectId) continue;
    try {
      const response = (await client.getObject({ id: field.objectId, options: { showContent: true } })) as RpcObjectResponse;
      const template = parseTaskTemplate(response?.data?.content);
      if (template) templates.push(template);
    } catch (error) {
      warnings.push(`Unable to read task template dynamic field ${field.objectId}: ${String(error)}`);
    }
  }
  templates.sort((a, b) => Number(a.templateId) - Number(b.templateId));
  return {
    systemFeeBps: toU64String(stateFields.system_fee_bps),
    minPayment: toU64String(stateFields.min_payment),
    templates,
  };
}

export async function getOracleStatus(): Promise<OracleStatusResponse> {
  const runtime = getRuntimeConfig();
  const client = new IotaClient({ url: runtime.rpcUrl });
  const warnings: string[] = [];
  if (!runtime.oracleTasksPackageId) {
    warnings.push("ORACLE_TASKS_PACKAGE_ID is not configured. Dashboard is running in degraded mode.");
  }

  const activeThresholdMs = Date.now() - config.activeWindowMinutes * 60 * 1000;
  let latestCheckpoint: string | null = null;
  try {
    latestCheckpoint = await client.getLatestCheckpointSequenceNumber();
  } catch (error) {
    warnings.push(`Unable to read latest checkpoint: ${String(error)}`);
  }

  const content = runtime.oracleStateId ? await getStateObjectContent(client, runtime.oracleStateId, warnings) : null;
  const registeredNodes = content ? parseRegisteredNodes(content) : [];
  const registeredNodeAddresses = registeredNodes.map((node) => node.address);
  const configuredCosts = await getConfiguredCosts(client, runtime.oracleStateId, warnings);
  const acceptedTasksByAddress = new Map(
    registeredNodes.map((node) => [
      normalizeAddress(node.address),
      formatAcceptedTasks(node.acceptedTemplateIds, configuredCosts.templates),
    ]),
  );

  let taskEvents: OracleEventItem[] = [];
  let messageEvents: OracleEventItem[] = [];
  if (runtime.oracleTasksPackageId) {
    try {
      [taskEvents, messageEvents] = await Promise.all([
        queryModuleEvents(client, runtime.oracleTasksPackageId, config.oracleTaskModule, config.eventFetchLimit),
        queryModuleEvents(client, runtime.oracleTasksPackageId, config.oracleMessageModule, config.eventFetchLimit),
      ]);
    } catch (error) {
      warnings.push(`Unable to query oracle events: ${String(error)}`);
    }
  }

  const combined = [...taskEvents, ...messageEvents].sort((a, b) => Number(b.timestampMs ?? "0") - Number(a.timestampMs ?? "0"));
  const effectiveRegisteredNodes = registeredNodeAddresses.length > 0 ? registeredNodeAddresses : [...new Set(config.oracleNodeAddresses.map(normalizeAddress).filter(Boolean))];
  const nodeActivity = toNodeActivity(
    combined,
    activeThresholdMs,
    effectiveRegisteredNodes.map((address) => ({
      address,
      pubkey: null,
      pubkeyBytes: 0,
      acceptedTemplateIds: acceptedTasksByAddress.get(normalizeAddress(address))?.map((item) => item.split(" - ")[0]) ?? [],
    })),
  ).map((node) => ({
    ...node,
    acceptedTasks: acceptedTasksByAddress.get(normalizeAddress(node.sender)) ?? [],
  }));
  const activeNodes = nodeActivity.filter((node) => node.active).length;
  const knownNodes = effectiveRegisteredNodes.length > 0 ? effectiveRegisteredNodes.length : null;
  const inactiveKnownNodes = knownNodes == null ? null : knownNodes - activeNodes;

  return {
    ok: true,
    mode: runtime.oracleTasksPackageId ? "live" : "degraded",
    network: runtime.network || "unknown",
    rpcUrl: runtime.rpcUrl,
    packageId: runtime.oracleTasksPackageId || null,
    tasksPackageId: runtime.oracleTasksPackageId || null,
    systemPackageId: runtime.oracleSystemPackageId || null,
    stateId: runtime.oracleStateId || null,
    latestCheckpoint,
    activeWindowMinutes: config.activeWindowMinutes,
    eventFetchLimit: config.eventFetchLimit,
    lastRefreshIso: new Date().toISOString(),
    metrics: {
      activeNodes,
      knownNodes,
      inactiveKnownNodes,
      taskEvents: taskEvents.length,
      messageEvents: messageEvents.length,
      totalEvents: combined.length,
    },
    costs: configuredCosts,
    registeredNodes,
    nodeActivity,
    recentEvents: combined.slice(0, 50),
    warnings,
  };
}
