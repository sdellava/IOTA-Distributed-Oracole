import { resolvePdfSource, extractPdfText } from "../utils/pdf";
import { callLlmJson } from "../utils/llm";

function stringifySchema(schema: any): string {
  return JSON.stringify(schema, null, 2);
}

function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
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
  documentSha256: string;
  pageRange: [number, number] | null;
  text: string;
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
    `Document SHA-256: ${opts.documentSha256}`,
    `Document pages considered: ${pageRangeLabel(opts.pageRange)}`,
    "Output schema:",
    stringifySchema(opts.schema),
    "Rules:",
    ...rules.map((r, idx) => `${idx + 1}. ${r}`),
    "Document text:",
    opts.text,
  ].join("\n\n");
}

export async function runPdfLlmJsonTask(opts: {
  payload: any;
  objective: string;
  extraRules?: string[];
}): Promise<{ canonical: string; parsed: any }> {
  const pdf = await resolvePdfSource(opts.payload);
  const extractedText = await extractPdfText(pdf.bytes, pdf.pageRange);
  const maxChars = Math.max(2_000, Number(opts.payload?.llm?.max_input_chars ?? process.env.LLM_MAX_INPUT_CHARS ?? 20_000));
  const schema = requireSchema(opts.payload);

  const prompt = promptEnvelope({
    objective: opts.objective,
    documentUrl: pdf.url,
    documentSha256: pdf.sha256Hex,
    pageRange: pdf.pageRange,
    text: clampText(extractedText, maxChars),
    schema,
    extraRules: opts.extraRules,
  });

  const result = await callLlmJson({
    taskName: String(opts.payload?.type ?? "LLM_TASK"),
    prompt,
    schema,
    llmConfig: opts.payload?.llm,
    normalization: opts.payload?.normalization,
  });

  return { canonical: result.canonical, parsed: result.parsed };
}
