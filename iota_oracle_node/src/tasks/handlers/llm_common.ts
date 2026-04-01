import { callLlmJsonWithPdfUrl } from "../utils/llm";

function stringifySchema(schema: any): string {
  return JSON.stringify(schema, null, 2);
}

function normalizeUrl(value: unknown): string {
  const url = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error(`Invalid PDF source url: ${url}`);
  return url;
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
