// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { httpFetchBytes } from "../../http";
import { normalizeText } from "./text";

const execFile = promisify(execFileCb);

type PdfPageRange = [number, number];

function envInt(name: string, def: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

function normalizeHeaders(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = String(k ?? "").trim();
    if (!key || v == null) continue;
    const value = String(v).trim();
    if (!value) continue;
    out[key] = value;
  }
  return out;
}

function normalizeUrl(value: unknown): string {
  const url = String(value ?? "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error(`Invalid PDF source url: ${url}`);
  return url;
}

function parsePageRange(input: unknown): PdfPageRange | null {
  if (!Array.isArray(input) || input.length !== 2) return null;
  const a = Number(input[0]);
  const b = Number(input[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const start = Math.max(1, Math.floor(a));
  const end = Math.max(start, Math.floor(b));
  return [start, end];
}

export type ResolvedPdfSource = {
  url: string;
  bytes: Buffer;
  sha256Hex: string;
  pageRange: PdfPageRange | null;
};

export async function resolvePdfSource(payload: any): Promise<ResolvedPdfSource> {
  const source = payload?.source ?? {};
  const url = normalizeUrl(source?.url ?? payload?.url);
  const timeoutMs = Math.max(1_000, Number(source?.timeoutMs ?? payload?.timeouts?.step1Ms ?? envInt("LLM_PDF_FETCH_TIMEOUT_MS", 30_000)));
  const maxBytes = Math.max(1_024, Number(source?.maxBytes ?? envInt("LLM_PDF_MAX_DOWNLOAD_BYTES", 25_000_000)));
  const headers = normalizeHeaders(source?.headers);
  const pageRange = parsePageRange(source?.pdf?.pageRange ?? payload?.pdf?.pageRange);

  const fetched = await httpFetchBytes({
    url,
    method: String(source?.method ?? "GET").toUpperCase(),
    headers,
    timeoutMs,
    maxBytes,
  });

  const mimeType = String(source?.mimeType ?? payload?.mimeType ?? fetched.contentType ?? "").toLowerCase();
  if (mimeType && !mimeType.includes("pdf")) {
    throw new Error(`PDF source returned unsupported mime type: ${mimeType}`);
  }

  const sha256Hex = createHash("sha256").update(fetched.bytes).digest("hex");
  const expectedSha256 = String(source?.expected_sha256 ?? source?.expectedSha256 ?? payload?.expected_sha256 ?? payload?.expectedSha256 ?? "")
    .trim()
    .toLowerCase();
  if (expectedSha256 && expectedSha256 !== sha256Hex) {
    throw new Error(`PDF SHA-256 mismatch: expected ${expectedSha256}, got ${sha256Hex}`);
  }

  return { url, bytes: fetched.bytes, sha256Hex, pageRange };
}

export async function extractPdfText(pdfBytes: Buffer, pageRange: PdfPageRange | null): Promise<string> {
  const bin = process.env.LLM_PDFTOTEXT_BIN?.trim() || "pdftotext";
  const timeoutMs = envInt("LLM_PDFTOTEXT_TIMEOUT_MS", 60_000);
  const dir = await mkdtemp(path.join(tmpdir(), "oracle-llm-pdf-"));
  const inputPath = path.join(dir, "input.pdf");
  const outputPath = path.join(dir, "output.txt");

  try {
    await writeFile(inputPath, pdfBytes);

    const args = ["-q", "-enc", "UTF-8", "-nopgbrk", "-eol", "unix"];
    if (pageRange) {
      args.push("-f", String(pageRange[0]), "-l", String(pageRange[1]));
    }
    args.push(inputPath, outputPath);

    await execFile(bin, args, {
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: envInt("LLM_PDFTOTEXT_MAX_BUFFER_BYTES", 10_000_000),
    });
    const text = await readFile(outputPath, "utf8");

    return normalizeText(text, {
      trim: true,
      collapseWhitespace: false,
      lineEnding: "lf",
    });
  } catch (e: any) {
    throw new Error(`PDF text extraction failed: ${String(e?.message ?? e)}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
