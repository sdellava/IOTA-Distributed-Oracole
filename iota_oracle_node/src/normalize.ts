type TextNorm = {
  kind?: "text";
  trim?: boolean;
  collapseWhitespace?: boolean;
  lineEnding?: "lf" | "crlf";
};

export function normalizeText(input: string, norm: TextNorm): string {
  let s = String(input ?? "");

  // normalize line endings to LF internally
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // collapse whitespace within each line (keeps line breaks)
  if (norm?.collapseWhitespace) {
    s = s
      .split("\n")
      .map((line) => line.replace(/[ \t\f\v]+/g, " "))
      .join("\n");
  }

  // trim whole text
  if (norm?.trim) s = s.trim();

  // output line endings
  if ((norm?.lineEnding ?? "lf") === "crlf") {
    s = s.replace(/\n/g, "\r\n");
  }

  return s;
}
