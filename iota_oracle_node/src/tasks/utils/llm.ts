import { normalizeJsonCanonical } from "./json";
import { validateAgainstSchema } from "./schema";

function envInt(name: string, def: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function parseJsonObject(text: string): any {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("Empty LLM response");

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`LLM response is not valid JSON: ${trimmed.slice(0, 300)}`);
    return JSON.parse(match[0]);
  }
}

function extractMessageContent(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;

  const choice0 = payload?.choices?.[0]?.message?.content;
  if (typeof choice0 === "string" && choice0.trim()) return choice0;
  if (Array.isArray(choice0)) {
    const joined = choice0
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("\n")
      .trim();
    if (joined) return joined;
  }

  const output = payload?.output;
  if (Array.isArray(output)) {
    for (const block of output) {
      const parts = Array.isArray(block?.content) ? block.content : [];
      const joined = parts
        .map((part: any) => {
          if (typeof part?.text === "string") return part.text;
          if (typeof part === "string") return part;
          return "";
        })
        .join("\n")
        .trim();
      if (joined) return joined;
    }
  }

  throw new Error(`Unsupported LLM response payload: ${JSON.stringify(payload).slice(0, 400)}`);
}

function parseExtraHeaders(): Record<string, string> {
  const raw = process.env.LLM_API_HEADERS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const key = String(k ?? "").trim();
      if (!key || v == null) continue;
      const value = String(v).trim();
      if (!value) continue;
      out[key] = value;
    }
    return out;
  } catch (e: any) {
    throw new Error(`Invalid LLM_API_HEADERS_JSON: ${String(e?.message ?? e)}`);
  }
}

export async function callLlmJson(opts: {
  taskName: string;
  prompt: string;
  schema: any;
  llmConfig?: any;
  normalization?: any;
}): Promise<{ parsed: any; canonical: string; rawText: string }> {
  const apiUrl = process.env.LLM_API_URL?.trim();
  const model = String(opts.llmConfig?.model ?? process.env.LLM_MODEL ?? "").trim();
  if (!apiUrl) throw new Error("Missing env LLM_API_URL");
  if (!model) throw new Error("Missing env LLM_MODEL");

  const timeoutMs = Math.max(1_000, Number(opts.llmConfig?.timeoutMs ?? opts.llmConfig?.timeout_ms ?? envInt("LLM_TIMEOUT_MS", 60_000)));
  const temperature = Number(opts.llmConfig?.temperature ?? 0);
  const topP = Number(opts.llmConfig?.top_p ?? opts.llmConfig?.topP ?? 1);
  const maxTokens = Number(opts.llmConfig?.max_output_tokens ?? opts.llmConfig?.maxTokens ?? envInt("LLM_MAX_OUTPUT_TOKENS", 400));
  const apiKey = process.env.LLM_API_KEY?.trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...parseExtraHeaders(),
  };
  if (apiKey && !headers.Authorization) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model,
    temperature,
    top_p: topP,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a deterministic extraction engine. Return only valid JSON. Do not add markdown, commentary, or code fences.",
      },
      {
        role: "user",
        content: opts.prompt,
      },
    ],
  };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status} ${res.statusText}: ${raw.slice(0, 600)}`);

    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(raw);
    } catch (e: any) {
      throw new Error(`Invalid LLM JSON envelope: ${String(e?.message ?? e)} | ${raw.slice(0, 400)}`);
    }

    const rawText = extractMessageContent(parsedPayload);
    const parsed = parseJsonObject(rawText);
    validateAgainstSchema(parsed, opts.schema);
    const normalizedInput = JSON.parse(JSON.stringify(parsed));
    const canonical = normalizeJsonCanonical(normalizedInput, opts.normalization ?? { canonical: true, dropNulls: false, sortArrays: true });
    return { parsed, canonical, rawText };
  } finally {
    clearTimeout(t);
  }
}
