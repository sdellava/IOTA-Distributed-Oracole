// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { TaskHandler } from "../types";
import { runPdfLlmJsonTask } from "./llm_common";

export const handleLlmExtractStructured: TaskHandler = async ({ payload }) => {
  const wantsConfidence = Object.prototype.hasOwnProperty.call(payload?.llm?.output_schema?.properties ?? {}, "confidence_bps");
  const extraRules = [
    "Normalize dates to YYYY-MM-DD when the document provides enough information.",
    "Keep identifiers exactly as shown in the text, except for trimming surrounding whitespace.",
  ];

  if (wantsConfidence) {
    extraRules.push("Set confidence_bps as an integer between 0 and 10000.");
  }

  const result = await runPdfLlmJsonTask({
    payload,
    objective: "Extract structured data from the PDF into the target schema.",
    extraRules,
  });

  return result.canonical;
};
