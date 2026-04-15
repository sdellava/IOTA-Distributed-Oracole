// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { TaskHandler } from "../types";
import { httpFetchText } from "../../http";
import { normalizeText } from "../../normalize";

export const handleGetTextStrip: TaskHandler = async ({ payload }) => {
  const req = payload?.request ?? {};
  const url = String(req.url ?? "").trim();
  if (!url) throw new Error("Missing payload.request.url");

  const method = String(req.method ?? "GET").toUpperCase();
  const headers = req.headers && typeof req.headers === "object" ? (req.headers as Record<string, string>) : {};
  const timeoutMs = Number(payload?.timeouts?.step1Ms ?? 10_000);

  const raw = await httpFetchText({ url, method, headers, timeoutMs });
  return normalizeText(raw, payload?.normalization ?? {});
};
