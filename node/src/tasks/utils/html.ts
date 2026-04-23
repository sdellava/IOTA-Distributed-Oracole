// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

type HtmlNorm = {
  kind?: "html_text";
  stripScripts?: boolean;
  stripStyles?: boolean;
  stripComments?: boolean;
  removeSelectors?: string[];
  dropTextPatterns?: string[];
  trim?: boolean;
  collapseWhitespace?: boolean;
  lineEnding?: "lf" | "crlf";
};

function decodeEntities(s: string): string {
  // minimal entity decode (enough for most pages)
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return s
    .replace(/&([a-zA-Z]+);/g, (_, name) => (named[name] ?? `&${name};`))
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const n = parseInt(String(h), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    });
}

function stripTagBlocks(html: string, tag: string): string {
  const t = tag.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!t) return html;
  const re = new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?<\\/${t}>`, "gi");
  return html.replace(re, " ");
}

export function normalizeHtmlText(input: string, norm: HtmlNorm): string {
  let s = String(input ?? "");

  if (norm?.stripComments ?? true) {
    s = s.replace(/<!--[\s\S]*?-->/g, " ");
  }

  const removeTags = new Set<string>();
  if (norm?.stripScripts ?? true) removeTags.add("script");
  if (norm?.stripStyles ?? true) removeTags.add("style");

  const selectors = Array.isArray(norm?.removeSelectors) ? norm.removeSelectors : [];
  for (const sel of selectors) {
    const t = String(sel ?? "").trim().toLowerCase();
    // support only simple tag selectors here (script/style/header/footer/nav/noscript/...)
    if (t && /^[a-z][a-z0-9-]*$/.test(t)) removeTags.add(t);
  }

  for (const t of removeTags) s = stripTagBlocks(s, t);

  // remove remaining tags -> spaces
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);

  // drop dynamic text patterns (timestamps etc.)
  const pats = Array.isArray(norm?.dropTextPatterns) ? norm.dropTextPatterns : [];
  for (const p of pats) {
    try {
      const re = new RegExp(String(p), "gi");
      s = s.replace(re, " ");
    } catch {
      // ignore invalid regex
    }
  }

  // normalize line endings to LF internally
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (norm?.collapseWhitespace ?? true) {
    s = s.replace(/[\t\f\v ]+/g, " ");
    s = s.replace(/\n+/g, "\n");
  }

  if (norm?.trim ?? true) s = s.trim();

  if ((norm?.lineEnding ?? "lf") === "crlf") s = s.replace(/\n/g, "\r\n");

  return s;
}
