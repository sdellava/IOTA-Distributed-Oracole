// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

export async function httpFetchText(opts: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<string> {
  const { url, method, headers = {}, timeoutMs = 10_000 } = opts;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method, headers, signal: ac.signal });
    const text = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}

export async function httpFetchBytes(opts: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<{ bytes: Buffer; contentType: string | null }> {
  const { url, method = "GET", headers = {}, timeoutMs = 30_000, maxBytes = 25_000_000 } = opts;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(url, { method, headers, signal: ac.signal, redirect: "follow" as RequestRedirect });
    const ab = await res.arrayBuffer();
    const bytes = Buffer.from(ab);

    if (!res.ok) {
      const preview = bytes.toString("utf8", 0, Math.min(bytes.length, 200));
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${preview}`);
    }
    if (bytes.length > maxBytes) {
      throw new Error(`Download too large: ${bytes.length} bytes > max ${maxBytes}`);
    }

    return {
      bytes,
      contentType: res.headers.get("content-type"),
    };
  } finally {
    clearTimeout(t);
  }
}
