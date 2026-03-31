type TextNormalization = {
  trim?: boolean;
  collapseWhitespace?: boolean;
  lineEnding?: "lf" | "crlf";
};

export function normalizeText(input: string, norm: TextNormalization): string {
  let s = String(input ?? "");

  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (norm?.collapseWhitespace) {
    s = s
      .split("\n")
      .map((line) => line.replace(/[ \t\f\v]+/g, " "))
      .join("\n");
  }

  if (norm?.trim) s = s.trim();

  if ((norm?.lineEnding ?? "lf") === "crlf") {
    s = s.replace(/\n/g, "\r\n");
  }

  return s;
}
