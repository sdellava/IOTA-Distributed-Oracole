export function normalizeText(input: string, opts: { trim?: boolean; collapseWhitespace?: boolean; lineEnding?: "lf" | "crlf" }): string {
  let s = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (opts.collapseWhitespace) {
    s = s.split("\n").map((line) => line.replace(/[ \t]+/g, " ").trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n");
  }
  if (opts.trim) s = s.trim();
  if (opts.lineEnding === "crlf") s = s.replace(/\n/g, "\r\n");
  return s;
}
