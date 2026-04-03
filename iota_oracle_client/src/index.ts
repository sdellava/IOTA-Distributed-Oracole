import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
try {
  require("dotenv/config");
} catch {
  // Optional dependency in minimal/runtime-only containers.
}

import fs from "node:fs";
import path from "node:path";
import { Transaction } from "@iota/iota-sdk/transactions";

import { iotaClient } from "./iota";
import { loadOrCreateClientIdentity } from "./keys";
import { requestFaucetIfEnabled } from "./faucet";
import { bcsU64, bcsU8, bcsVecU8, utf8ToBytes } from "./bcs";
import { bytesToUtf8, decodeVecU8 } from "./events";
import { signAndExecuteWithLockRetry } from "./txRetry.js";

type AnyClient = ReturnType<typeof iotaClient> & Record<string, any>;

type TaskTemplateInfo = {
  templateId: number;
  taskType: string;
  isEnabled: number;
  basePriceIota: bigint;
  maxInputBytes: bigint;
  maxOutputBytes: bigint;
  includedDownloadBytes: bigint;
  pricePerDownloadByteIota: bigint;
  allowStorage: number;
  minRetentionDays: bigint;
  maxRetentionDays: bigint;
  pricePerRetentionDayIota: bigint;
};

type StateEconomics = {
  systemFeeBps: bigint;
  minPayment: bigint;
};

type PreparedTask = {
  templateId: number;
  taskType: string;
  payloadJson: any;
  payloadText: string;
  requestedNodes: number;
  quorumK: number;
  mediationMode: number;
  varianceMax: number;
  retentionDays: number;
  declaredDownloadBytes: bigint;
  createResultControllerCap: number;
  storageSourceUrl?: string;
};

type CreateTaskContext = {
  tasksPkg: string;
  stateId: string;
  treasuryId: string;
  randomId: string;
  clockId: string;
  prepared: PreparedTask;
  requiredPayment: bigint;
  gasBudget: bigint;
};

type PreparedWalletTransaction = {
  ok: true;
  mode: "prepare-webview";
  sender: string;
  variant: string;
  serializedTransaction: string;
  gasBudget: string;
  requiredPayment: string;
  rawPrice: string;
  systemFee: string;
  totalPrice: string;
  downloadPrice: string;
  extraDownloadBytes: string;
  balance: string;
  treasuryBalanceBefore: string | null;
  template: {
    templateId: number;
    taskType: string;
  };
  prepared: {
    templateId: number;
    taskType: string;
    requestedNodes: number;
    quorumK: number;
    retentionDays: number;
    declaredDownloadBytes: string;
    createResultControllerCap: number;
    mediationMode: number;
    varianceMax: number;
    storageSourceUrl?: string;
    payloadJson: any;
  };
};

const EMediationVarianceTooHigh = 401;
const IOTA_DECIMALS = 1_000_000_000n;
const CMC_IOTA_SOURCE_URL = "https://coinmarketcap.com/currencies/iota/";
const CMC_PUBLIC_QUOTE_URL = "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/quote/latest?id=1720";

type StructRef = { address: string; module: string; name: string };
type IotaUsdQuote = {
  usdPrice: number;
  fetchedAtIso: string;
  sourceUrl: string;
};

function mustEnv(k: string): string {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
}

function envAny(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

function getTasksPackageId(): string {
  const v = envAny("ORACLE_TASKS_PACKAGE_ID", "ORACLE_PACKAGE_ID");
  if (!v) throw new Error("Missing env ORACLE_TASKS_PACKAGE_ID (or legacy ORACLE_PACKAGE_ID)");
  return v;
}

function getSystemPackageId(): string {
  const v = envAny("ORACLE_SYSTEM_PACKAGE_ID");
  if (!v) throw new Error("Missing env ORACLE_SYSTEM_PACKAGE_ID");
  return v;
}

function getStateId(): string {
  const v = envAny("ORACLE_STATE_ID", "ORACLE_STATUS_ID", "ORACLE_SYSTEM_STATE_ID");
  if (!v) throw new Error("Missing env ORACLE_STATE_ID (or legacy ORACLE_STATUS_ID / ORACLE_SYSTEM_STATE_ID)");
  return v;
}

function getTreasuryId(): string {
  const v = envAny("ORACLE_TREASURY_ID", "ORACLE_TREASURY_OBJECT_ID");
  if (!v) throw new Error("Missing env ORACLE_TREASURY_ID");
  return v;
}

function loadTaskJson(arg?: string): any {
  if (!arg) {
    const defaults = ["task.json", "examples/task.json", "examples/task_weather.json", "examples/task_storage.json"];
    for (const d of defaults) {
      const p = path.resolve(process.cwd(), d);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      }
    }
    throw new Error("Usage: npm run create -- <task.json | inline-json>");
  }

  const p = path.resolve(process.cwd(), arg);
  const raw = fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : arg;
  return JSON.parse(raw);
}

function parsePositiveInt(raw: unknown, field: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${field}: ${String(raw)}`);
  return Math.floor(n);
}

function parseRequestedNodes(taskObj: any): number {
  return parsePositiveInt(taskObj?.requested_nodes ?? taskObj?.nodes ?? 3, "requested_nodes");
}

function parseQuorumK(taskObj: any, requestedNodes: number): number {
  const q = taskObj?.consensus?.quorum;
  if (!q) return requestedNodes;

  const qt = String(q.type ?? "").toLowerCase();
  const v = Number(q.value);

  if (qt === "abs" || qt === "n") {
    const k = Math.floor(v);
    if (!Number.isFinite(k) || k <= 0 || k > requestedNodes) throw new Error(`Invalid quorum abs value: ${q.value}`);
    return k;
  }

  if (qt === "pct") {
    if (!Number.isFinite(v) || v <= 0 || v > 1) throw new Error(`Invalid quorum pct value: ${q.value}`);
    const k = Math.ceil(v * requestedNodes);
    return Math.max(1, Math.min(requestedNodes, k));
  }

  return requestedNodes;
}

function parseTemplateId(taskObj: any): number {
  const raw = taskObj?.template_id ?? taskObj?.templateId;
  if (raw == null) throw new Error('Task JSON must contain numeric "template_id"');
  return parsePositiveInt(raw, "template_id");
}

function parseRetentionDays(taskObj: any): number {
  const raw =
    taskObj?.retention_days ??
    taskObj?.retentionDays ??
    taskObj?.storage?.retention_days ??
    taskObj?.storage?.retentionDays ??
    0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid retention_days: ${String(raw)}`);
  return Math.floor(n);
}

function parseDeclaredDownloadBytes(taskObj: any): bigint {
  const raw =
    taskObj?.declared_download_bytes ??
    taskObj?.declaredDownloadBytes ??
    taskObj?.source?.declared_download_bytes ??
    taskObj?.source?.declaredDownloadBytes ??
    taskObj?.storage?.declared_download_bytes ??
    taskObj?.storage?.declaredDownloadBytes;

  if (raw == null || raw === "") return 0n;

  try {
    const n = BigInt(String(raw).trim());
    if (n < 0n) throw new Error("negative");
    return n;
  } catch {
    throw new Error(`Invalid declared_download_bytes: ${String(raw)}`);
  }
}

function toPlainStringMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string" && k.trim()) out[k] = v;
  }
  return out;
}

function pickStorageSourceUrl(taskObj: any): string {
  const sourceUrl = typeof taskObj?.source?.url === "string" ? taskObj.source.url.trim() : "";
  if (!sourceUrl) throw new Error("STORAGE task requires source.url");
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new Error(`STORAGE source.url must start with http:// or https://: ${sourceUrl}`);
  }
  return sourceUrl;
}

function parseStorageProbeTimeoutMs(taskObj: any): number {
  const raw =
    taskObj?.timeouts?.step1Ms ??
    taskObj?.timeouts?.storageProbeMs ??
    taskObj?.storage?.probe_timeout_ms ??
    taskObj?.storage?.probeTimeoutMs ??
    process.env.STORAGE_PROBE_TIMEOUT_MS ??
    15000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 15000;
  return Math.floor(n);
}

async function probeStorageContentLength(taskObj: any): Promise<bigint> {
  const sourceUrl = pickStorageSourceUrl(taskObj);
  const headers = toPlainStringMap(taskObj?.source?.headers);
  const timeoutMs = parseStorageProbeTimeoutMs(taskObj);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const extractSize = (res: Response): bigint | null => {
    const contentRange = res.headers.get("content-range")?.trim() ?? "";
    const m = contentRange.match(/\/(\d+)$/);
    if (m) return BigInt(m[1]);

    const contentLength = res.headers.get("content-length")?.trim() ?? "";
    if (contentLength) return BigInt(contentLength);

    return null;
  };

  try {
    const attempts: Array<() => Promise<Response>> = [
      () =>
        fetch(sourceUrl, {
          method: "HEAD",
          headers,
          redirect: "follow",
          signal: controller.signal,
        }),
      () =>
        fetch(sourceUrl, {
          method: "GET",
          headers: { ...headers, Range: "bytes=0-0" },
          redirect: "follow",
          signal: controller.signal,
        }),
    ];

    const errors: string[] = [];

    for (const attempt of attempts) {
      try {
        const res = await attempt();
        if (!res.ok) {
          errors.push(`HTTP ${res.status} ${res.statusText}`);
          continue;
        }

        const n = extractSize(res);
        if (n != null && n >= 0n) return n;

        errors.push("Missing Content-Length/Content-Range");
      } catch (e: any) {
        errors.push(String(e?.message ?? e));
      }
    }

    throw new Error(errors.join(" | "));
  } catch (e: any) {
    throw new Error(`Unable to determine STORAGE content length for ${sourceUrl}: ${String(e?.message ?? e)}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseMediationMode(taskObj: any): number {
  const raw = taskObj?.mediation_mode ?? taskObj?.mediationMode ?? taskObj?.mediation?.mode;
  if (raw == null) return 0;

  if (typeof raw === "number") return Math.floor(raw);
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "none" || s === "off" || s === "disabled" || s === "0") return 0;
  if (s === "mean_u64" || s === "meanu64" || s === "mean" || s === "1") return 1;
  return Number.NaN;
}

function parseVarianceMax(taskObj: any): number {
  const raw =
    taskObj?.variance_max ??
    taskObj?.varianceMax ??
    taskObj?.mediation?.variance_max ??
    taskObj?.mediation?.varianceMax;
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.floor(n);
}

function getMoveFields(obj: any): Record<string, any> {
  const c: any = obj?.data?.content;
  if (!c || c.dataType !== "moveObject") return {};
  return (c.fields ?? {}) as Record<string, any>;
}

function unwrapFieldValue(obj: any): Record<string, any> {
  const fields = getMoveFields(obj);
  const value = fields.value;
  if (value && typeof value === "object") {
    if ((value as any).fields && typeof (value as any).fields === "object") return (value as any).fields;
    return value as Record<string, any>;
  }
  return fields;
}

function moveObjectIdToString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (!v || typeof v !== "object") return "";

  const o: any = v;
  const direct = [o.objectId, o.id, o.bytes, o.value];
  for (const candidate of direct) {
    const resolved = moveObjectIdToString(candidate);
    if (resolved) return resolved;
  }

  if (o.fields && typeof o.fields === "object") {
    const resolved = moveObjectIdToString(o.fields);
    if (resolved) return resolved;
  }

  for (const val of Object.values(o)) {
    const resolved = moveObjectIdToString(val);
    if (resolved) return resolved;
  }

  return "";
}

function asBigInt(v: unknown, fallback = 0n): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.floor(v));
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return fallback;
    try {
      return BigInt(t);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function asFiniteNumber(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function extractUsdPriceFromCoinMarketCapPayload(payload: unknown): number | null {
  const root = payload as any;

  const directCandidates: unknown[] = [
    root?.data?.[0]?.quotes?.[0]?.price,
    root?.data?.[0]?.quote?.USD?.price,
    root?.data?.[1720]?.quote?.USD?.price,
    root?.data?.["1720"]?.quote?.USD?.price,
    root?.data?.IOTA?.[0]?.quote?.USD?.price,
    root?.data?.IOTA?.quote?.USD?.price,
  ];

  for (const candidate of directCandidates) {
    const v = asFiniteNumber(candidate);
    if (v != null) return v;
  }

  const candidates = Array.isArray(root?.data?.quotes) ? root.data.quotes : [];
  for (const q of candidates) {
    const symbol = String(q?.name ?? q?.symbol ?? "").trim().toUpperCase();
    if (symbol !== "USD") continue;
    const v = asFiniteNumber(q?.price);
    if (v != null) return v;
  }

  return null;
}

async function fetchIotaUsdQuoteFromCoinMarketCap(): Promise<IotaUsdQuote | null> {
  try {
    const res = await fetch(CMC_PUBLIC_QUOTE_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const usdPrice = extractUsdPriceFromCoinMarketCapPayload(payload);
    if (usdPrice == null) return null;
    return {
      usdPrice,
      fetchedAtIso: new Date().toISOString(),
      sourceUrl: CMC_IOTA_SOURCE_URL,
    };
  } catch {
    return null;
  }
}

function collectStructRefsFromNormalizedType(typeNode: unknown): StructRef[] {
  const out: StructRef[] = [];

  const walk = (node: unknown) => {
    if (!node) return;
    if (typeof node === "string") {
      const m = node.match(/^(0x[a-fA-F0-9]+)::([^:]+)::([^:<]+)$/);
      if (m) out.push({ address: m[1].toLowerCase(), module: m[2], name: m[3] });
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object") return;

    const rec = node as Record<string, unknown>;
    if (rec.Struct && typeof rec.Struct === "object") {
      const s = rec.Struct as Record<string, unknown>;
      const address = String(s.address ?? "").trim().toLowerCase();
      const module = String(s.module ?? "").trim();
      const name = String(s.name ?? "").trim();
      if (address && module && name) out.push({ address, module, name });
      walk(s.typeArguments);
    }

    for (const value of Object.values(rec)) walk(value);
  };

  walk(typeNode);
  return out;
}

async function assertCreateTaskCompatibility(client: AnyClient, tasksPkg: string, systemPkg: string): Promise<void> {
  const getNormalizedMoveFunction = (client as any)?.getNormalizedMoveFunction;
  if (typeof getNormalizedMoveFunction !== "function") return;

  const normalized: any = await getNormalizedMoveFunction.call(client, {
    package: tasksPkg,
    module: "oracle_tasks",
    function: "create_task",
  });

  const parameters: unknown[] = Array.isArray(normalized?.parameters) ? normalized.parameters : [];
  if (parameters.length < 2) return;

  const p0 = collectStructRefsFromNormalizedType(parameters[0]);
  const p1 = collectStructRefsFromNormalizedType(parameters[1]);
  const expected = systemPkg.toLowerCase();

  const p0Ok = p0.some((s) => s.address === expected && s.module === "systemState" && s.name === "State");
  const p1Ok = p1.some((s) => s.address === expected && s.module === "systemState" && s.name === "OracleTreasury");

  if (p0Ok && p1Ok) return;

  const got0 = p0[0] ? `${p0[0].address}::${p0[0].module}::${p0[0].name}` : "<unknown>";
  const got1 = p1[0] ? `${p1[0].address}::${p1[0].module}::${p1[0].name}` : "<unknown>";
  throw new Error(
    `Package mismatch: ORACLE_TASKS_PACKAGE_ID=${tasksPkg} expects create_task params [${got0}, ${got1}], ` +
      `but ORACLE_SYSTEM_PACKAGE_ID=${systemPkg}. Republish oracle_tasks against the current oracle_system_state package and update env.`,
  );
}

function normalizeTaskPayload(taskObj: any): PreparedTask {
  const templateId = parseTemplateId(taskObj);
  const taskType = String(taskObj?.type ?? "").trim();
  if (!taskType) throw new Error('Task JSON must contain a non-empty top-level "type" field');

  const requestedNodes = parseRequestedNodes(taskObj);
  const quorumK = parseQuorumK(taskObj, requestedNodes);
  const mediationMode = parseMediationMode(taskObj);
  if (!Number.isFinite(mediationMode) || (mediationMode !== 0 && mediationMode !== 1)) {
    throw new Error("Invalid mediation_mode. Allowed: 0 (none) or 1 (mean_u64).");
  }
  const varianceMax = parseVarianceMax(taskObj);
  if (!Number.isFinite(varianceMax)) {
    throw new Error("Invalid variance_max. Must be a non-negative integer.");
  }
  const retentionDays = parseRetentionDays(taskObj);
  const createResultControllerCap =
    taskObj?.create_result_controller_cap === true || taskObj?.create_result_controller_cap === 1 ? 1 : 0;

  const payloadJson: any = { ...taskObj, requested_nodes: requestedNodes };
  delete payloadJson.nodes;
  delete payloadJson.create_result_controller_cap;

  let declaredDownloadBytes = 0n;
  let storageSourceUrl: string | undefined;

  if (taskType === "STORAGE") {
    storageSourceUrl = pickStorageSourceUrl(taskObj);
    declaredDownloadBytes = parseDeclaredDownloadBytes(taskObj);

    payloadJson.source = {
      ...(typeof payloadJson.source === "object" && payloadJson.source ? payloadJson.source : {}),
      url: storageSourceUrl,
      headers: toPlainStringMap(taskObj?.source?.headers),
    };

    if (declaredDownloadBytes > 0n) {
      payloadJson.declared_download_bytes = declaredDownloadBytes.toString();
    }
  }

  const payloadText = JSON.stringify(payloadJson);

  return {
    templateId,
    taskType,
    payloadJson,
    payloadText,
    requestedNodes,
    quorumK,
    mediationMode,
    varianceMax,
    retentionDays,
    declaredDownloadBytes,
    createResultControllerCap,
    storageSourceUrl,
  };
}
async function getStateEconomics(client: AnyClient, stateId: string): Promise<StateEconomics> {
  const obj = await client.getObject({ id: stateId, options: { showContent: true } });
  const f = getMoveFields(obj);
  return {
    systemFeeBps: asBigInt(f.system_fee_bps),
    minPayment: asBigInt(f.min_payment),
  };
}

async function getTaskTemplateById(
  client: any,
  stateId: string,
  systemPkg: string,
  templateId: number,
): Promise<TaskTemplateInfo | null> {
  try {
    const obj = await client.getDynamicFieldObject({
      parentId: stateId,
      name: {
        type: `${systemPkg}::systemState::TaskTemplateKey`,
        value: { template_id: templateId },
      },
    } as any);

    const v: any = unwrapFieldValue(obj);
    return {
      templateId: asNumber(v.template_id, templateId),
      taskType: bytesToUtf8(decodeVecU8(v.task_type)),
      isEnabled: asNumber(v.is_enabled),
      basePriceIota: asBigInt(v.base_price_iota),
      maxInputBytes: asBigInt(v.max_input_bytes),
      maxOutputBytes: asBigInt(v.max_output_bytes),
      includedDownloadBytes: asBigInt(v.included_download_bytes),
      pricePerDownloadByteIota: asBigInt(v.price_per_download_byte_iota),
      allowStorage: asNumber(v.allow_storage),
      minRetentionDays: asBigInt(v.min_retention_days),
      maxRetentionDays: asBigInt(v.max_retention_days),
      pricePerRetentionDayIota: asBigInt(v.price_per_retention_day_iota),
    };
  } catch {
    // fall through to scan
  }

  let cursor: string | null = null;

  for (;;) {
    const page: any = await client.getDynamicFields({
      parentId: stateId,
      cursor,
      limit: 50,
    });

    for (const row of (page?.data ?? []) as any[]) {
      const rowName: any = row?.name ?? null;
      const rowType = String(rowName?.type ?? "");
      const rowValue: any = rowName?.value ?? null;
      const rowTemplateId = Number(rowValue?.template_id ?? rowValue?.templateId ?? NaN);

      const looksLikeTemplate =
        rowType.includes("TaskTemplateKey") || String(row?.objectType ?? "").includes("TaskTemplate");

      if (!looksLikeTemplate || rowTemplateId !== templateId) continue;

      const obj = await client.getObject({
        id: row.objectId,
        options: { showContent: true, showType: true },
      });

      const v: any = unwrapFieldValue(obj);
      return {
        templateId: asNumber(v.template_id, templateId),
        taskType: bytesToUtf8(decodeVecU8(v.task_type)),
        isEnabled: asNumber(v.is_enabled),
        basePriceIota: asBigInt(v.base_price_iota),
        maxInputBytes: asBigInt(v.max_input_bytes),
        maxOutputBytes: asBigInt(v.max_output_bytes),
        includedDownloadBytes: asBigInt(v.included_download_bytes),
        pricePerDownloadByteIota: asBigInt(v.price_per_download_byte_iota),
        allowStorage: asNumber(v.allow_storage),
        minRetentionDays: asBigInt(v.min_retention_days),
        maxRetentionDays: asBigInt(v.max_retention_days),
        pricePerRetentionDayIota: asBigInt(v.price_per_retention_day_iota),
      };
    }

    if (!page?.hasNextPage) break;
    cursor = page?.nextCursor ?? null;
  }

  return null;
}
function validateAgainstTemplate(prepared: PreparedTask, template: TaskTemplateInfo, economics: StateEconomics) {
  if (template.isEnabled !== 1) {
    throw new Error(`Template ${template.templateId} exists but is disabled`);
  }

  const payloadBytes = Buffer.byteLength(prepared.payloadText, "utf8");
  if (template.maxInputBytes > 0n && BigInt(payloadBytes) > template.maxInputBytes) {
    throw new Error(
      `Payload too large for template ${template.templateId}: ${payloadBytes} bytes > max_input_bytes=${template.maxInputBytes.toString()}`,
    );
  }

  if (template.allowStorage === 0 && prepared.retentionDays > 0) {
    throw new Error(
      `Template ${template.templateId} does not allow storage but task asks retention_days=${prepared.retentionDays}`,
    );
  }

  if (template.allowStorage === 1) {
    if (BigInt(prepared.retentionDays) < template.minRetentionDays) {
      throw new Error(
        `retention_days=${prepared.retentionDays} below template minimum ${template.minRetentionDays.toString()} for template ${template.templateId}`,
      );
    }
    if (template.maxRetentionDays > 0n && BigInt(prepared.retentionDays) > template.maxRetentionDays) {
      throw new Error(
        `retention_days=${prepared.retentionDays} above template maximum ${template.maxRetentionDays.toString()} for template ${template.templateId}`,
      );
    }
  }

  if (template.taskType && template.taskType !== prepared.taskType) {
    throw new Error(
      `Template ${template.templateId} expects task_type=${template.taskType}, but task JSON requested type=${prepared.taskType}`,
    );
  }

  if (prepared.taskType === "STORAGE") {
    if (prepared.declaredDownloadBytes <= 0n) {
      throw new Error("STORAGE task requires declared_download_bytes > 0");
    }
    if (template.maxOutputBytes > 0n && prepared.declaredDownloadBytes > template.maxOutputBytes) {
      throw new Error(
        `STORAGE declared_download_bytes=${prepared.declaredDownloadBytes.toString()} exceeds template max_output_bytes=${template.maxOutputBytes.toString()} for template ${template.templateId}`,
      );
    }
  }

  const extraDownloadBytes =
    prepared.declaredDownloadBytes > template.includedDownloadBytes
      ? prepared.declaredDownloadBytes - template.includedDownloadBytes
      : 0n;
  const downloadPrice = extraDownloadBytes * template.pricePerDownloadByteIota;
  const rawPrice =
    template.basePriceIota + downloadPrice + BigInt(prepared.retentionDays) * template.pricePerRetentionDayIota;
  const systemFee = (rawPrice * economics.systemFeeBps + 9_999n) / 10_000n;
  const totalPrice = rawPrice + systemFee;
  const requiredPayment = totalPrice > economics.minPayment ? totalPrice : economics.minPayment;
  return { rawPrice, systemFee, totalPrice, requiredPayment, downloadPrice, extraDownloadBytes };
}

async function fetchIotaBalance(client: AnyClient, owner: string): Promise<bigint> {
  const bal = await client.getBalance({ owner, coinType: "0x2::iota::IOTA" });
  return asBigInt(bal?.totalBalance, 0n);
}

async function fetchTreasuryBalance(client: AnyClient, treasuryId: string, systemPkg: string): Promise<bigint | null> {
  const keyType = `${systemPkg}::systemState::OracleTreasuryBalanceKey`;
  const names = [
    { type: keyType, value: {} },
    { type: keyType, value: null as any },
  ];

  for (const name of names) {
    try {
      const df = await client.getDynamicFieldObject({ parentId: treasuryId, name } as any);
      const v = unwrapFieldValue(df) as any;
      const direct = asBigInt(v?.balance, -1n);
      if (direct >= 0n) return direct;
      const nested = asBigInt(v?.fields?.balance, -1n);
      if (nested >= 0n) return nested;
      const coinValue = asBigInt(v?.value, -1n);
      if (coinValue >= 0n) return coinValue;
    } catch {
      // continue
    }
  }

  let cursor: any = null;
  for (;;) {
    const page = await client.getDynamicFields({ parentId: treasuryId, cursor, limit: 50 });
    for (const row of page.data ?? []) {
      const rowType = String(row?.name?.type ?? "");
      if (!rowType.includes("OracleTreasuryBalanceKey")) continue;
      try {
        const obj = await client.getObject({ id: row.objectId, options: { showContent: true, showType: true } });
        const v = unwrapFieldValue(obj) as any;
        const direct = asBigInt(v?.balance, -1n);
        if (direct >= 0n) return direct;
        const nested = asBigInt(v?.fields?.balance, -1n);
        if (nested >= 0n) return nested;
      } catch {
        // ignore and continue scan
      }
    }
    if (!page.hasNextPage) break;
    cursor = page.nextCursor;
  }

  return null;
}

function isTaskFinalizedObjectFields(f: Record<string, any>): boolean {
  const resultBytes = decodeVecU8(f.result);
  return resultBytes.length > 0 || Number(f.state ?? -1) === 9;
}

async function isTaskFinalized(client: AnyClient, taskId: string): Promise<boolean> {
  const obj = await client.getObject({ id: taskId, options: { showContent: true } });
  return isTaskFinalizedObjectFields(getMoveFields(obj));
}

type TaskCompositeState = {
  taskId: string;
  taskFields: Record<string, any>;
  configId: string;
  configFields: Record<string, any>;
  runtimeId: string;
  runtimeFields: Record<string, any>;
};

async function readTaskCompositeState(client: AnyClient, taskId: string): Promise<TaskCompositeState> {
  const taskObj = await client.getObject({ id: taskId, options: { showContent: true, showType: true } });
  const taskFields = getMoveFields(taskObj);
  const configId = moveObjectIdToString(taskFields.config_id);
  const runtimeId = moveObjectIdToString(taskFields.runtime_id);

  const [configObj, runtimeObj] = await Promise.all([
    configId ? client.getObject({ id: configId, options: { showContent: true, showType: true } }) : null,
    runtimeId ? client.getObject({ id: runtimeId, options: { showContent: true, showType: true } }) : null,
  ]);

  return {
    taskId,
    taskFields,
    configId,
    configFields: configObj ? getMoveFields(configObj) : {},
    runtimeId,
    runtimeFields: runtimeObj ? getMoveFields(runtimeObj) : {},
  };
}

function readTaskMediationMeta(snapshot: TaskCompositeState): {
  mediationMode: number;
  mediationAttempts: number;
  mediationStatus: number;
  mediationVariance: number;
} {
  const task = snapshot.taskFields;
  const config = snapshot.configFields;
  const runtime = snapshot.runtimeFields;

  return {
    mediationMode: Number(task.mediation_mode ?? config.mediation_mode ?? runtime.mediation_mode ?? 0),
    mediationAttempts: Number(task.mediation_attempts ?? runtime.mediation_attempts ?? 0),
    mediationStatus: Number(task.mediation_status ?? runtime.mediation_status ?? 0),
    mediationVariance: Number(task.mediation_variance ?? runtime.mediation_variance ?? 0),
  };
}

async function waitTaskCompletedOrResult(opts: {
  client: AnyClient;
  taskId: string;
  timeoutMs?: number;
  pollMs?: number;
}) {
  const { client, taskId } = opts;
  const timeoutMs = opts.timeoutMs ?? Number(process.env.WAIT_TIMEOUT_MS ?? "180000");
  const pollMs = opts.pollMs ?? Number(process.env.EVENT_POLL_MS ?? "1200");

  const started = Date.now();
  let lastLog = 0;

  while (Date.now() - started < timeoutMs) {
    const snapshot = await readTaskCompositeState(client, taskId);
    const task = snapshot.taskFields;
    const state = Number(task.state ?? -1);
    const round = Number(task.active_round ?? 0);
    const { mediationMode, mediationAttempts, mediationStatus, mediationVariance } = readTaskMediationMeta(snapshot);

    const resultBytes = decodeVecU8(task.result);
    if (resultBytes.length > 0 || state === 9) return { kind: "finalized" as const, state };

    if (state === 10) {
      const mediationEnabled = mediationMode === 1;
      if (mediationEnabled && (mediationStatus === 2 || mediationAttempts > 0)) {
        const reason = mediationStatus === 2 ? "mediation_blocked" : "mediation_attempted";
        console.log(
          `[client] terminal no_consensus via failed state (${reason}, round=${round}, attempts=${mediationAttempts}, status=${mediationStatus}, variance=${mediationVariance})`,
        );
        return { kind: "no_consensus" as const, state };
      }
      return { kind: "failed" as const, state };
    }

    if (state === 4) {
      const mediationEnabled = mediationMode === 1;
      if (!mediationEnabled) return { kind: "no_consensus" as const, state };

      if (mediationStatus === 2) {
        console.log(
          `[client] mediation blocked -> terminal no_consensus (round=${round}, attempts=${mediationAttempts}, variance=${mediationVariance})`,
        );
        return { kind: "no_consensus" as const, state };
      }

      if (mediationAttempts > 0) {
        console.log(
          `[client] mediation already attempted -> terminal no_consensus (round=${round}, attempts=${mediationAttempts}, status=${mediationStatus})`,
        );
        return { kind: "no_consensus" as const, state };
      }

      const now = Date.now();
      if (now - lastLog > 10_000) {
        console.log(
          `[client] state=4 (no_consensus) but mediation pending -> keep waiting (round=${round}, attempts=${mediationAttempts}, status=${mediationStatus})`,
        );
        lastLog = now;
      }
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`Timeout waiting terminal state for taskId=${taskId}`);
}

function getTxStatusInfo(res: any): { status: string; error: string } {
  const status = String(res?.effects?.status?.status ?? res?.effects?.status ?? "").trim();
  const error = String(res?.effects?.status?.error ?? "").trim();
  return { status, error };
}

async function fetchFullTransactionBlock(client: AnyClient, digest: string): Promise<any | null> {
  const getTx = (client as any).getTransactionBlock;
  if (typeof getTx !== "function") return null;
  try {
    return await getTx.call(client, {
      digest,
      options: { showEffects: true, showEvents: true, showObjectChanges: true, showInput: true },
    });
  } catch {
    return null;
  }
}

function mergeTxResults(primary: any, fallback: any): any {
  if (!fallback) return primary;
  return {
    ...primary,
    ...fallback,
    effects: fallback.effects ?? primary.effects,
    events: fallback.events ?? primary.events,
    objectChanges: fallback.objectChanges ?? primary.objectChanges,
    digest: fallback.digest ?? primary.digest,
  };
}

async function hydrateExecutedTransaction(client: AnyClient, res: any): Promise<any> {
  const digest = String(res?.digest ?? "").trim();
  if (!digest) return res;

  const full = await fetchFullTransactionBlock(client, digest);
  return mergeTxResults(res, full);
}

function requireSuccessfulTransaction(res: any) {
  const { status, error } = getTxStatusInfo(res);
  if (!status) return;
  if (status.toLowerCase() == "success") return;
  throw new Error(`create_task transaction failed: status=${status}${error ? ` error=${error}` : ""}`);
}

function extractEventsArray(res: any): any[] {
  if (!res) return [];
  if (Array.isArray(res.events)) return res.events;
  const d = (res.events as any)?.data;
  return Array.isArray(d) ? d : [];
}

function extractTaskIdFromTx(res: any): string {
  const events = extractEventsArray(res);
  const createdEv = events.find(
    (e) =>
      String(e.type ?? "").endsWith("::oracle_tasks::TaskLifecycleEvent") && Number(e.parsedJson?.kind ?? -1) === 1,
  );
  const eventTaskId = createdEv?.parsedJson?.task_id;
  const byEvent =
    typeof eventTaskId === "string"
      ? eventTaskId.trim()
      : String((eventTaskId as any)?.id ?? (eventTaskId as any)?.objectId ?? (eventTaskId as any)?.bytes ?? "").trim();
  if (byEvent) return byEvent;

  const oc: any[] = Array.isArray(res.objectChanges) ? res.objectChanges : [];
  const createdTask = oc.find(
    (c) =>
      c.type === "created" &&
      String(c.objectType ?? "").includes("::oracle_tasks::Task") &&
      !String(c.objectType ?? "").includes("TaskOwnerCap"),
  );
  const byTaskObj = String(createdTask?.objectId ?? "").trim();
  if (byTaskObj) return byTaskObj;

  const ownerCap = oc.find(
    (c) => c.type === "created" && String(c.objectType ?? "").includes("::oracle_tasks::TaskOwnerCap"),
  );
  const capTaskId = String(
    ownerCap?.fields?.task_id ?? ownerCap?.content?.fields?.task_id ?? ownerCap?.data?.content?.fields?.task_id ?? "",
  ).trim();
  if (capTaskId) return capTaskId;

  const created = Array.isArray(res?.effects?.created) ? res.effects.created : [];
  for (const row of created) {
    const objectId = String(row?.reference?.objectId ?? row?.objectId ?? "").trim();
    if (objectId) return objectId;
  }

  return "";
}

function makeLegacyCreateTaskTx(ctx: CreateTaskContext): Transaction {
  const { tasksPkg, stateId, randomId, clockId, prepared, gasBudget } = ctx;
  const tx = new Transaction();
  tx.setGasBudget(Number(gasBudget));
  tx.moveCall({
    target: `${tasksPkg}::oracle_tasks::create_task`,
    arguments: [
      tx.object(stateId),
      tx.object(randomId),
      tx.object(clockId),
      tx.pure(bcsU64(prepared.requestedNodes)),
      tx.pure(bcsU64(prepared.quorumK)),
      tx.pure(bcsVecU8(utf8ToBytes(prepared.taskType))),
      tx.pure(bcsVecU8(utf8ToBytes(prepared.payloadText))),
      tx.pure(bcsU8(prepared.mediationMode)),
      tx.pure(bcsU64(prepared.varianceMax)),
      tx.pure(bcsU8(prepared.createResultControllerCap)),
    ],
  });
  return tx;
}

function makeTemplateCreateTaskTx(ctx: CreateTaskContext, variant: string): Transaction {
  const { tasksPkg, stateId, treasuryId, randomId, clockId, prepared, requiredPayment, gasBudget } = ctx;
  const tx = new Transaction();
  tx.setGasBudget(Number(gasBudget));
  const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure(bcsU64(requiredPayment))]);

  const common = {
    target: `${tasksPkg}::oracle_tasks::create_task`,
  };

  if (variant === "state_treasury_payment_v1") {
    tx.moveCall({
      ...common,
      arguments: [
        tx.object(stateId),
        tx.object(treasuryId),
        paymentCoin,
        tx.object(randomId),
        tx.object(clockId),
        tx.pure(bcsU64(prepared.templateId)),
        tx.pure(bcsU64(prepared.requestedNodes)),
        tx.pure(bcsU64(prepared.quorumK)),
        tx.pure(bcsVecU8(utf8ToBytes(prepared.payloadText))),
        tx.pure(bcsU64(prepared.retentionDays)),
        tx.pure(bcsU64(prepared.declaredDownloadBytes)),
        tx.pure(bcsU8(prepared.mediationMode)),
        tx.pure(bcsU64(prepared.varianceMax)),
        tx.pure(bcsU8(prepared.createResultControllerCap)),
      ],
    });
    return tx;
  }

  if (variant === "template_payment_v1") {
    tx.moveCall({
      ...common,
      arguments: [
        tx.object(stateId),
        tx.object(randomId),
        tx.object(clockId),
        paymentCoin,
        tx.pure(bcsU64(prepared.templateId)),
        tx.pure(bcsU64(prepared.retentionDays)),
        tx.pure(bcsU64(prepared.requestedNodes)),
        tx.pure(bcsU64(prepared.quorumK)),
        tx.pure(bcsVecU8(utf8ToBytes(prepared.taskType))),
        tx.pure(bcsVecU8(utf8ToBytes(prepared.payloadText))),
        tx.pure(bcsU8(prepared.mediationMode)),
        tx.pure(bcsU64(prepared.varianceMax)),
        tx.pure(bcsU8(prepared.createResultControllerCap)),
      ],
    });
    return tx;
  }

  if (variant === "template_payment_v2") {
    tx.moveCall({
      ...common,
      arguments: [
        tx.object(stateId),
        tx.object(randomId),
        tx.object(clockId),
        paymentCoin,
        tx.pure(bcsU64(prepared.templateId)),
        tx.pure(bcsU64(prepared.requestedNodes)),
        tx.pure(bcsU64(prepared.quorumK)),
        tx.pure(bcsVecU8(utf8ToBytes(prepared.taskType))),
        tx.pure(bcsVecU8(utf8ToBytes(prepared.payloadText))),
        tx.pure(bcsU8(prepared.mediationMode)),
        tx.pure(bcsU64(prepared.varianceMax)),
        tx.pure(bcsU64(prepared.retentionDays)),
        tx.pure(bcsU8(prepared.createResultControllerCap)),
      ],
    });
    return tx;
  }

  if (variant === "template_payment_v3") {
    tx.moveCall({
      ...common,
      arguments: [
        tx.object(stateId),
        tx.object(randomId),
        tx.object(clockId),
        paymentCoin,
        tx.pure(bcsU64(prepared.templateId)),
        tx.pure(bcsU64(prepared.retentionDays)),
        tx.pure(bcsU64(prepared.requestedNodes)),
        tx.pure(bcsU64(prepared.quorumK)),
        tx.pure(bcsVecU8(utf8ToBytes(prepared.payloadText))),
        tx.pure(bcsU8(prepared.mediationMode)),
        tx.pure(bcsU64(prepared.varianceMax)),
        tx.pure(bcsU8(prepared.createResultControllerCap)),
      ],
    });
    return tx;
  }

  if (variant === "template_payment_v4") {
    tx.moveCall({
      ...common,
      arguments: [
        tx.object(stateId),
        tx.object(randomId),
        tx.object(clockId),
        paymentCoin,
        tx.pure(bcsU64(prepared.templateId)),
        tx.pure(bcsU64(prepared.requestedNodes)),
        tx.pure(bcsU64(prepared.quorumK)),
        tx.pure(bcsVecU8(utf8ToBytes(prepared.payloadText))),
        tx.pure(bcsU8(prepared.mediationMode)),
        tx.pure(bcsU64(prepared.varianceMax)),
        tx.pure(bcsU64(prepared.retentionDays)),
        tx.pure(bcsU8(prepared.createResultControllerCap)),
      ],
    });
    return tx;
  }

  throw new Error(`Unknown create_task variant: ${variant}`);
}

function buildCreateTaskVariants(ctx: CreateTaskContext): Record<string, () => Transaction> {
  return {
    state_treasury_payment_v1: () => makeTemplateCreateTaskTx(ctx, "state_treasury_payment_v1"),
    legacy_v0: () => makeLegacyCreateTaskTx(ctx),
  };
}

function isSignatureMismatchError(error: unknown): boolean {
  const msg = String((error as any)?.message ?? error ?? "").toLowerCase();
  if (!msg) return false;
  return [
    "expected ",
    "but got",
    "could not resolve function",
    "unused value without drop",
    "argument",
    "arity",
    "type mismatch",
    "wrong number of arguments",
    "unable to process transaction. could not serialize argument",
  ].some((needle) => msg.includes(needle));
}

function devInspectLooksSuccessful(res: any): boolean {
  const err = String(res?.error ?? "").trim();
  if (err) return false;

  const status = String(res?.effects?.status?.status ?? res?.effects?.status ?? "").toLowerCase();
  if (status && status !== "success") return false;

  const effectsErr = String(res?.effects?.status?.error ?? "").trim();
  if (effectsErr) return false;

  return true;
}

async function pickCreateTaskVariant(
  client: AnyClient,
  sender: string,
  builders: Record<string, () => Transaction>,
): Promise<string[]> {
  const forced = process.env.CREATE_TASK_VARIANT?.trim();
  const names = Object.keys(builders);
  if (forced) {
    if (!builders[forced]) throw new Error(`Unknown CREATE_TASK_VARIANT=${forced}`);
    return [forced];
  }

  const inspect = (client as any).devInspectTransactionBlock;
  if (typeof inspect !== "function") return names;

  const winners: string[] = [];
  for (const name of names) {
    try {
      const res = await inspect.call(client, { sender, transactionBlock: builders[name]() });
      if (devInspectLooksSuccessful(res)) winners.push(name);
    } catch {
      // ignore and keep scanning
    }
  }

  return winners.length > 0 ? [...winners, ...names.filter((n) => !winners.includes(n))] : names;
}

async function executeCreateTask(
  client: AnyClient,
  signer: any,
  sender: string,
  builders: Record<string, () => Transaction>,
): Promise<{ res: any; variant: string }> {
  const orderedNames = await pickCreateTaskVariant(client, sender, builders);
  let lastError: unknown;

  for (let i = 0; i < orderedNames.length; i += 1) {
    const variant = orderedNames[i];
    try {
      console.log(`[client] create_task variant=${variant}`);
      const rawRes = await signAndExecuteWithLockRetry({
        client,
        signer,
        transactionFactory: builders[variant],
        options: { showEffects: true, showEvents: true, showObjectChanges: true },
        label: `create_task:${variant}`,
      });
      const res = await hydrateExecutedTransaction(client, rawRes);
      requireSuccessfulTransaction(res);
      return { res, variant };
    } catch (error) {
      lastError = error;
      if (!isSignatureMismatchError(error) || i === orderedNames.length - 1) throw error;
      console.warn(
        `[client] create_task variant ${variant} rejected, trying next: ${String((error as any)?.message ?? error)}`,
      );
    }
  }

  throw lastError;
}

function serializeTransactionForWallet(tx: Transaction): string {
  const maybeSerialize = (tx as any)?.serialize;
  if (typeof maybeSerialize !== "function") {
    throw new Error("Current @iota/iota-sdk Transaction.serialize() is not available");
  }
  return String(maybeSerialize.call(tx));
}

async function prepareCreateTaskPlan(client: AnyClient, sender: string, taskArg?: string) {
  const tasksPkg = getTasksPackageId();
  const systemPkg = getSystemPackageId();
  const stateId = getStateId();
  const treasuryId = getTreasuryId();
  const randomId = (process.env.IOTA_RANDOM_OBJECT_ID ?? "0x8").trim() || "0x8";
  const clockId = (process.env.IOTA_CLOCK_OBJECT_ID ?? process.env.IOTA_CLOCK_ID ?? "0x6").trim() || "0x6";
  await assertCreateTaskCompatibility(client, tasksPkg, systemPkg);

  const taskObj = loadTaskJson(taskArg);
  const prepared = normalizeTaskPayload(taskObj);
  const gasBudget = asBigInt(process.env.GAS_BUDGET ?? "50000000", 50_000_000n);
  const template = await getTaskTemplateById(client, stateId, systemPkg, prepared.templateId);
  if (!template) {
    throw new Error(`Template ${prepared.templateId} not found under state ${stateId}`);
  }

  if (prepared.taskType === "STORAGE" && prepared.declaredDownloadBytes <= 0n) {
    const detectedSize = await probeStorageContentLength(prepared.payloadJson);
    prepared.declaredDownloadBytes = detectedSize;
    prepared.payloadJson.declared_download_bytes = detectedSize.toString();
    prepared.payloadText = JSON.stringify(prepared.payloadJson);
  }

  const economics = await getStateEconomics(client, stateId);
  const { rawPrice, systemFee, totalPrice, requiredPayment, downloadPrice, extraDownloadBytes } = validateAgainstTemplate(
    prepared,
    template,
    economics,
  );
  const balance = await fetchIotaBalance(client, sender);
  const treasuryBalanceBefore = await fetchTreasuryBalance(client, treasuryId, systemPkg);
  const needed = requiredPayment + gasBudget;
  if (balance < needed) {
    throw new Error(
      `Insufficient IOTA for address ${sender}: balance=${balance.toString()} required_payment=${requiredPayment.toString()} gas_budget=${gasBudget.toString()} total_needed=${needed.toString()}`,
    );
  }

  const builders = buildCreateTaskVariants({
    tasksPkg,
    stateId,
    treasuryId,
    randomId,
    clockId,
    prepared,
    requiredPayment,
    gasBudget,
  });

  return {
    tasksPkg,
    systemPkg,
    stateId,
    treasuryId,
    randomId,
    clockId,
    prepared,
    gasBudget,
    template,
    economics,
    rawPrice,
    systemFee,
    totalPrice,
    requiredPayment,
    downloadPrice,
    extraDownloadBytes,
    balance,
    treasuryBalanceBefore,
    builders,
  };
}

async function runPrepareWebview(taskArg: string | undefined, sender: string | undefined) {
  const normalizedSender = String(sender ?? "").trim();
  if (!normalizedSender) {
    throw new Error("Usage: npm run create -- prepare-webview <task.json | inline-json> <sender-address>");
  }

  const client = iotaClient() as AnyClient;
  const plan = await prepareCreateTaskPlan(client, normalizedSender, taskArg);
  const orderedNames = await pickCreateTaskVariant(client, normalizedSender, plan.builders);
  const variant = orderedNames[0];
  if (!variant) throw new Error("Unable to determine a create_task variant for webview preparation");

  const tx = plan.builders[variant]();
  tx.setSender(normalizedSender);

  const payload: PreparedWalletTransaction = {
    ok: true,
    mode: "prepare-webview",
    sender: normalizedSender,
    variant,
    serializedTransaction: serializeTransactionForWallet(tx),
    gasBudget: plan.gasBudget.toString(),
    requiredPayment: plan.requiredPayment.toString(),
    rawPrice: plan.rawPrice.toString(),
    systemFee: plan.systemFee.toString(),
    totalPrice: plan.totalPrice.toString(),
    downloadPrice: plan.downloadPrice.toString(),
    extraDownloadBytes: plan.extraDownloadBytes.toString(),
    balance: plan.balance.toString(),
    treasuryBalanceBefore: plan.treasuryBalanceBefore == null ? null : plan.treasuryBalanceBefore.toString(),
    template: {
      templateId: plan.template.templateId,
      taskType: plan.template.taskType,
    },
    prepared: {
      templateId: plan.prepared.templateId,
      taskType: plan.prepared.taskType,
      requestedNodes: plan.prepared.requestedNodes,
      quorumK: plan.prepared.quorumK,
      retentionDays: plan.prepared.retentionDays,
      declaredDownloadBytes: plan.prepared.declaredDownloadBytes.toString(),
      createResultControllerCap: plan.prepared.createResultControllerCap,
      mediationMode: plan.prepared.mediationMode,
      varianceMax: plan.prepared.varianceMax,
      storageSourceUrl: plan.prepared.storageSourceUrl,
      payloadJson: plan.prepared.payloadJson,
    },
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function runCliCreate(taskArg?: string) {
  const client = iotaClient() as AnyClient;
  const id = loadOrCreateClientIdentity();

  console.log(`[client] address=${id.address}`);
  await requestFaucetIfEnabled(id.address);

  const plan = await prepareCreateTaskPlan(client, id.address, taskArg);
  const quote = await fetchIotaUsdQuoteFromCoinMarketCap();

  console.log(
    `[client] template=${plan.template.templateId} template_task_type=${plan.template.taskType || "<empty>"} requested_type=${plan.prepared.taskType} treasury=${plan.treasuryId}`,
  );
  console.log(
    `[client] price raw=${plan.rawPrice.toString()} system_fee=${plan.systemFee.toString()} total=${plan.totalPrice.toString()} download_price=${plan.downloadPrice.toString()} extra_download_bytes=${plan.extraDownloadBytes.toString()} min_payment=${plan.economics.minPayment.toString()} required=${plan.requiredPayment.toString()} retention_days=${plan.prepared.retentionDays} declared_download_bytes=${plan.prepared.declaredDownloadBytes.toString()}`,
  );
  if (quote) {
    const requiredIota = Number(plan.requiredPayment) / Number(IOTA_DECIMALS);
    const rawIota = Number(plan.rawPrice) / Number(IOTA_DECIMALS);
    const feeIota = Number(plan.systemFee) / Number(IOTA_DECIMALS);
    const usdRaw = rawIota * quote.usdPrice;
    const usdFee = feeIota * quote.usdPrice;
    const usdRequired = requiredIota * quote.usdPrice;
    console.log(
      `[client] cmc_iota_usd=${quote.usdPrice.toFixed(8)} source=${quote.sourceUrl} fetched_at=${quote.fetchedAtIso}`,
    );
    console.log(
      `[client] price_usd raw=${usdRaw.toFixed(6)} fee=${usdFee.toFixed(6)} required=${usdRequired.toFixed(6)}`,
    );
  } else {
    console.log("[client] cmc_iota_usd unavailable (source fetch failed)");
  }

  const needed = plan.requiredPayment + plan.gasBudget;
  console.log(`[client] balance=${plan.balance.toString()} need_at_least=${needed.toString()} (payment + gas_budget)`);
  if (plan.treasuryBalanceBefore != null)
    console.log(`[client] treasury balance before=${plan.treasuryBalanceBefore.toString()}`);

  const { res, variant } = await executeCreateTask(client, id.keypair, id.address, plan.builders);
  console.log(`[client] digest ${res.digest}`);
  console.log(`[client] create_task chosen variant ${variant}`);
  const txStatus = getTxStatusInfo(res);
  if (txStatus.status) {
    console.log(`[client] tx_status=${txStatus.status}${txStatus.error ? ` error=${txStatus.error}` : ""}`);
  }

  const treasuryBalanceAfter = await fetchTreasuryBalance(client, plan.treasuryId, plan.systemPkg);
  if (treasuryBalanceAfter != null)
    console.log(
      `[client] treasury balance after=${treasuryBalanceAfter.toString()} delta=${plan.treasuryBalanceBefore == null ? "?" : (treasuryBalanceAfter - plan.treasuryBalanceBefore).toString()}`,
    );

  const taskId = extractTaskIdFromTx(res);
  if (!taskId) {
    console.warn("[client] could not determine task_id from tx (events/objectChanges)");
    return;
  }

  console.log(`[client] task_id ${taskId}`);

  if (await isTaskFinalized(client, taskId)) {
    console.log("[client] task already finalized (result present), skipping wait");
  } else {
    console.log("[client] waiting terminal state...");
    const done = await waitTaskCompletedOrResult({ client, taskId });
    console.log(`[client] terminal: ${done.kind} state=${done.state}`);
  }

  const snapshot = await readTaskCompositeState(client, taskId);
  const taskFields = snapshot.taskFields;
  const configFields = snapshot.configFields;
  const runtimeFields = snapshot.runtimeFields;
  const mediationMeta = readTaskMediationMeta(snapshot);

  console.log(`task_payment_iota: ${String(taskFields.payment_iota ?? "0")}`);
  console.log(`task_template_id: ${String(taskFields.template_id ?? "0")}`);
  console.log(`task_config_id: ${snapshot.configId || "<missing>"}`);
  console.log(`task_runtime_id: ${snapshot.runtimeId || "<missing>"}`);
  console.log(`task_retention_days: ${String(configFields.retention_days ?? "0")}`);
  console.log(`task_declared_download_bytes: ${String(configFields.declared_download_bytes ?? "0")}`);
  console.log(`task_mediation_mode: ${String(mediationMeta.mediationMode)}`);
  console.log(
    `task_variance_max: ${String(configFields.variance_max ?? runtimeFields.variance_max ?? taskFields.variance_max ?? "0")}`,
  );
  console.log(`task_mediation_attempts: ${String(mediationMeta.mediationAttempts)}`);
  console.log(`task_mediation_status: ${String(mediationMeta.mediationStatus)}`);
  console.log(`task_mediation_variance: ${String(mediationMeta.mediationVariance)}`);
  const resultBytes = decodeVecU8(taskFields.result);
  const multisigBytes = decodeVecU8(taskFields.multisig_bytes);
  const multisigAddr = String(taskFields.multisig_addr ?? "");

  console.log("--- TASK RESULT ---");
  console.log("multisig_addr:", multisigAddr);
  console.log("multisig_bytes_b64:", Buffer.from(multisigBytes).toString("base64"));
  console.log("result_utf8 (first 4000 chars):\n", new TextDecoder().decode(resultBytes).slice(0, 4000));
}

async function main() {
  const mode = String(process.argv[2] ?? "").trim();
  if (mode === "prepare-webview") {
    await runPrepareWebview(process.argv[3], process.argv[4]);
    return;
  }

  await runCliCreate(process.argv[2]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
