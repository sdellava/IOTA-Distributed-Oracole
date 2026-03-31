import type { TaskHandler } from "../types";
import { httpFetchText } from "../../http";
import { normalizeJsonCanonical } from "../utils/json";

export const handleGetJsonCanonical: TaskHandler = async ({ payload }) => {
  const req = payload?.request ?? {};
  const url = String(req.url ?? "").trim();
  if (!url) throw new Error("Missing payload.request.url");

  const method = String(req.method ?? "GET").toUpperCase();
  const headers = req.headers && typeof req.headers === "object" ? (req.headers as Record<string, string>) : {};
  const timeoutMs = Number(payload?.timeouts?.step1Ms ?? 10_000);

  const raw = await httpFetchText({ url, method, headers, timeoutMs });

  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Invalid JSON response: ${String(e?.message ?? e)}`);
  }

  return normalizeJsonCanonical(obj, payload?.normalization ?? {});
};
