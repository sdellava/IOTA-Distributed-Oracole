// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { httpFetchText } from "../../http";
import { normalizeHtmlText } from "../utils/html";
import { callLlmJson, callLlmJsonWithPdfUrl } from "../utils/llm";

function stringifySchema(schema: any): string {
  return JSON.stringify(schema, null, 2);
}

function normalizeUrl(value: unknown): string {
  const url = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error(`Invalid source url: ${url}`);
  return url;
}

function normalizeMethod(value: unknown): string {
  const method = String(value ?? "GET").trim().toUpperCase();
  return method || "GET";
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    const key = String(k ?? "").trim();
    if (!key || v == null) continue;
    out[key] = String(v);
  }
  return out;
}

function resolveSourceMimeType(payload: any): string {
  return String(payload?.source?.mimeType ?? payload?.mimeType ?? "").trim().toLowerCase();
}

function parsePageRange(input: unknown): [number, number] | null {
  if (!Array.isArray(input) || input.length !== 2) return null;
  const a = Number(input[0]);
  const b = Number(input[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const start = Math.max(1, Math.floor(a));
  const end = Math.max(start, Math.floor(b));
  return [start, end];
}

function pageRangeLabel(pageRange: [number, number] | null): string {
  if (!pageRange) return "all pages";
  return pageRange[0] === pageRange[1] ? `page ${pageRange[0]}` : `pages ${pageRange[0]}-${pageRange[1]}`;
}

function requireSchema(payload: any): any {
  const schema = payload?.llm?.output_schema;
  if (!schema || typeof schema !== "object") throw new Error("Missing payload.llm.output_schema");
  return schema;
}

function promptEnvelope(opts: {
  objective: string;
  documentUrl: string;
  pageRange: [number, number] | null;
  schema: any;
  extraRules?: string[];
}): string {
  const rules = [
    "Return exactly one JSON object.",
    "Do not include markdown fences.",
    "Use only values explicitly supported by the document text.",
    "If a value cannot be determined with confidence, use an empty string for strings, false for booleans, and 0 for integers unless the schema or task rules require otherwise.",
    ...(opts.extraRules ?? []),
  ];

  return [
    `Objective: ${opts.objective}`,
    `Document URL: ${opts.documentUrl}`,
    `Document pages considered: ${pageRangeLabel(opts.pageRange)}`,
    "IMPORTANT: Use only the specified page range for extraction/classification.",
    "Output schema:",
    stringifySchema(opts.schema),
    "Rules:",
    ...rules.map((r, idx) => `${idx + 1}. ${r}`),
  ].join("\n\n");
}

export async function runPdfLlmJsonTask(opts: {
  payload: any;
  objective: string;
  extraRules?: string[];
}): Promise<{ canonical: string; parsed: any }> {
  const source = opts.payload?.source ?? {};
  const pdfUrl = normalizeUrl(source?.url ?? opts.payload?.url);
  const pageRange = parsePageRange(source?.pdf?.pageRange ?? opts.payload?.pdf?.pageRange);
  const schema = requireSchema(opts.payload);

  const prompt = promptEnvelope({
    objective: opts.objective,
    documentUrl: pdfUrl,
    pageRange,
    schema,
    extraRules: opts.extraRules,
  });

  const result = await callLlmJsonWithPdfUrl({
    taskName: String(opts.payload?.type ?? "LLM_TASK"),
    prompt,
    schema,
    pdfUrl,
    llmConfig: opts.payload?.llm,
    normalization: opts.payload?.normalization,
  });

  return { canonical: result.canonical, parsed: result.parsed };
}

export async function runUrlTextLlmJsonTask(opts: {
  payload: any;
  objective: string;
  extraRules?: string[];
}): Promise<{ canonical: string; parsed: any }> {
  const source = opts.payload?.source ?? {};
  const url = normalizeUrl(source?.url ?? opts.payload?.url);
  const schema = requireSchema(opts.payload);
  const method = normalizeMethod(source?.method ?? opts.payload?.method);
  const headers = normalizeHeaders(source?.headers ?? opts.payload?.headers);
  const timeoutMs = Number(opts.payload?.timeouts?.step1Ms ?? 15_000);

  const raw = await httpFetchText({
    url,
    method,
    headers,
    timeoutMs,
  });

  const normalizedText = normalizeHtmlText(raw, opts.payload?.normalization ?? {});
  const prompt = [
    `Objective: ${opts.objective}`,
    `Source URL: ${url}`,
    "Source content follows between markers. Use only this content for extraction.",
    "Output schema:",
    stringifySchema(schema),
    "Rules:",
    "1. Return exactly one JSON object.",
    "2. Do not include markdown fences.",
    "3. Use only values explicitly supported by the provided content.",
    "4. If a value cannot be determined with confidence, use an empty string for strings, false for booleans, and 0 for integers unless the schema or task rules require otherwise.",
    ...(opts.extraRules ?? []).map((r, idx) => `${idx + 5}. ${r}`),
    "BEGIN SOURCE CONTENT",
    normalizedText,
    "END SOURCE CONTENT",
  ].join("\n\n");

  const result = await callLlmJson({
    taskName: String(opts.payload?.type ?? "LLM_TASK"),
    prompt,
    schema,
    llmConfig: opts.payload?.llm,
    normalization: { canonical: true, dropNulls: false, sortArrays: true },
  });

  return { canonical: result.canonical, parsed: result.parsed };
}

export async function runDocumentLlmJsonTask(opts: {
  payload: any;
  pdfObjective: string;
  textObjective: string;
  extraRules?: string[];
}): Promise<{ canonical: string; parsed: any }> {
  const mimeType = resolveSourceMimeType(opts.payload);
  const sourceKind = String(opts.payload?.source?.kind ?? "").trim().toLowerCase();
  const looksLikePdf = mimeType.includes("pdf");

  if (looksLikePdf) {
    return runPdfLlmJsonTask({
      payload: opts.payload,
      objective: opts.pdfObjective,
      extraRules: opts.extraRules,
    });
  }

  if (
    mimeType.includes("html") ||
    mimeType.startsWith("text/") ||
    sourceKind === "document_url" ||
    sourceKind === "url"
  ) {
    return runUrlTextLlmJsonTask({
      payload: opts.payload,
      objective: opts.textObjective,
      extraRules: opts.extraRules,
    });
  }

  throw new Error(`Unsupported source mime type for document extraction: ${mimeType || "<missing>"}`);
}
