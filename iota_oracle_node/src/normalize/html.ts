function stripComments(html: string): string { return html.replace(/<!--[\s\S]*?-->/g, ""); }
function stripTagBlocks(html: string, tag: "script" | "style"): string {
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi");
  return html.replace(re, "");
}
function stripTags(html: string): string { return html.replace(/<\/?[^>]+>/g, " "); }

export function normalizeHtml(input: string, opts: { removeScripts?: boolean; removeStyles?: boolean; stripComments?: boolean; collapseWhitespace?: boolean; dropPatterns?: string[] }): string {
  let s = input;
  if (opts.stripComments) s = stripComments(s);
  if (opts.removeScripts) s = stripTagBlocks(s, "script");
  if (opts.removeStyles) s = stripTagBlocks(s, "style");
  s = stripTags(s);
  for (const p of opts.dropPatterns ?? []) s = s.replace(new RegExp(p, "g"), "");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (opts.collapseWhitespace) s = s.replace(/[ \t]+/g, " ").replace(/\n+/g, "\n");
  return s.trim();
}
