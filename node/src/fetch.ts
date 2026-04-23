// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { Agent } from "undici";

const ipv4Agent = new Agent({ connect: { family: 4, rejectUnauthorized: false } as any });

export async function fetchUrl(url: string, headers?: Record<string, string>) {
  try {
    return await doFetch(url, headers);
  } catch {
    try {
      return await doFetch(url, headers, ipv4Agent);
    } catch (e2) {
      const msg = (e2 as Error)?.message ?? String(e2);
      const cause = (e2 as any)?.cause ? String((e2 as any).cause) : undefined;
      throw new Error(`fetch failed: ${msg}${cause ? ` | cause: ${cause}` : ""}`);
    }
  }
}

async function doFetch(url: string, headers?: Record<string, string>, dispatcher?: any) {
  const res = await fetch(url, { method: "GET", headers, dispatcher } as any);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const contentType = res.headers.get("content-type") ?? undefined;
  const buf = new Uint8Array(await res.arrayBuffer());
  const bodyText = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return { contentType, bodyText, bytes: buf.byteLength };
}
