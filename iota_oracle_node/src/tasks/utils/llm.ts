import { normalizeJsonCanonical } from "./json";
import { validateAgainstSchema } from "./schema";
import { httpFetchBytes } from "../../http";

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

function parseLlmPlugins(): any[] | undefined {
  const raw = process.env.LLM_PLUGINS_JSON?.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    return parsed;
  } catch (e: any) {
    throw new Error(`Invalid LLM_PLUGINS_JSON: ${String(e?.message ?? e)}`);
  }
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

function resolveResponsesApiUrl(): string {
  const explicit = process.env.LLM_RESPONSES_API_URL?.trim();
  if (explicit) return explicit;

  const apiUrl = process.env.LLM_API_URL?.trim() || "";
  if (apiUrl.includes("/chat/completions")) {
    return apiUrl.replace(/\/chat\/completions\/?$/i, "/responses");
  }
  if (apiUrl.endsWith("/responses")) return apiUrl;
  if (apiUrl) return apiUrl;
  return "https://api.openai.com/v1/responses";
}

function extractResponseApiText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;

  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const parts = Array.isArray(item?.content) ? item.content : [];
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

  throw new Error(`Unsupported Responses payload: ${JSON.stringify(payload).slice(0, 400)}`);
}

function looksLikeUrlDownloadTimeout(rawBody: string): boolean {
  const t = String(rawBody ?? "").toLowerCase();
  return t.includes("timeout while downloading") && t.includes('"param"') && t.includes("url");
}

function shouldRetryWithFileData(status: number, rawBody: string): boolean {
  if (status !== 400) return false;
  const t = String(rawBody ?? "").toLowerCase();
  return (
    looksLikeUrlDownloadTimeout(rawBody) ||
    t.includes("unsupported_file") ||
    t.includes("file type you uploaded is not supported") ||
    (t.includes("error while downloading") && t.includes('"param"') && t.includes("url")) ||
    (t.includes("invalid_value") && t.includes('"param"') && t.includes("url"))
  );
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "document.pdf";
    return last.toLowerCase().endsWith(".pdf") ? last : `${last}.pdf`;
  } catch {
    return "document.pdf";
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

  const plugins = parseLlmPlugins();
  const body: Record<string, any> = {
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
  if (plugins) body.plugins = plugins;

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

export async function callLlmJsonWithPdfUrl(opts: {
  taskName: string;
  prompt: string;
  schema: any;
  pdfUrl: string;
  llmConfig?: any;
  normalization?: any;
}): Promise<{ parsed: any; canonical: string; rawText: string }> {
  const apiUrl = resolveResponsesApiUrl();
  const model = String(opts.llmConfig?.model ?? process.env.LLM_MODEL ?? "").trim();
  if (!apiUrl) throw new Error("Missing env LLM_RESPONSES_API_URL/LLM_API_URL");
  if (!model) throw new Error("Missing env LLM_MODEL");

  const timeoutMs = Math.max(
    1_000,
    Number(opts.llmConfig?.timeoutMs ?? opts.llmConfig?.timeout_ms ?? envInt("LLM_TIMEOUT_MS", 60_000)),
  );
  const temperature = Number(opts.llmConfig?.temperature ?? 0);
  const topP = Number(opts.llmConfig?.top_p ?? opts.llmConfig?.topP ?? 1);
  const maxTokens = Number(
    opts.llmConfig?.max_output_tokens ?? opts.llmConfig?.maxTokens ?? envInt("LLM_MAX_OUTPUT_TOKENS", 400),
  );
  const apiKey = process.env.LLM_API_KEY?.trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...parseExtraHeaders(),
  };
  if (apiKey && !headers.Authorization) headers.Authorization = `Bearer ${apiKey}`;

  const plugins = parseLlmPlugins();
  const buildBody = (fileInput: { type: "input_file"; file_url?: string; file_data?: string; filename?: string }) => {
    const b: Record<string, any> = {
      model,
      temperature,
      top_p: topP,
      max_output_tokens: maxTokens,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are a deterministic extraction engine. Return only valid JSON with no markdown or prose.",
            },
          ],
        },
        {
          role: "user",
          content: [
            fileInput,
            { type: "input_text", text: opts.prompt },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "oracle_output",
          schema: opts.schema,
          strict: true,
        },
      },
    };
    if (plugins) b.plugins = plugins;
    return b;
  };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    let res = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody({ type: "input_file", file_url: opts.pdfUrl })),
      signal: ac.signal,
    });
    let raw = await res.text();

    // Fallback: if OpenAI can't download the URL, send the same PDF as base64 file_data.
    if (!res.ok && shouldRetryWithFileData(res.status, raw)) {
      const fetched = await httpFetchBytes({
        url: opts.pdfUrl,
        method: "GET",
        timeoutMs: Math.max(timeoutMs, 30_000),
        maxBytes: 25_000_000,
      });

      res = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(
          buildBody({
            type: "input_file",
            filename: filenameFromUrl(opts.pdfUrl),
            file_data: `data:application/pdf;base64,${fetched.bytes.toString("base64")}`,
          }),
        ),
        signal: ac.signal,
      });
      raw = await res.text();
    }

    if (!res.ok) throw new Error(`LLM HTTP ${res.status} ${res.statusText}: ${raw.slice(0, 600)}`);

    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(raw);
    } catch (e: any) {
      throw new Error(`Invalid LLM JSON envelope: ${String(e?.message ?? e)} | ${raw.slice(0, 400)}`);
    }

    const rawText = extractResponseApiText(parsedPayload);
    const parsed = parseJsonObject(rawText);
    validateAgainstSchema(parsed, opts.schema);
    const normalizedInput = JSON.parse(JSON.stringify(parsed));
    const canonical = normalizeJsonCanonical(normalizedInput, opts.normalization ?? { canonical: true, dropNulls: false, sortArrays: true });
    return { parsed, canonical, rawText };
  } finally {
    clearTimeout(t);
  }
}
