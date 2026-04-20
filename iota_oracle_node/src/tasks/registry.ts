// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { TaskHandler } from "./types";
import { handleGetTextStrip } from "./handlers/get_text_strip";
import { handleGetJsonCanonical } from "./handlers/get_json_canonical";
import { handleGetHtmlStripDynamic } from "./handlers/get_html_strip_dynamic";
import { handleStorage } from "./handlers/storage";
import { handleLlmExtractStructured } from "./handlers/llm_extract_structured";
import { handleLlmClassifyDocument } from "./handlers/llm_classify_document";
import { handleLlmRiskScore } from "./handlers/llm_risk_score";
import { handleLlmOpenQuestion } from "./handlers/llm_open_question";
import { handleTaskDlvcValidation } from "./handlers/task_dlvc_validation";

const handlers: Record<string, TaskHandler> = {
  GET_TEXT_STRIP: handleGetTextStrip,
  GET_JSON_CANONICAL: handleGetJsonCanonical,
  GET_HTML_STRIP_DYNAMIC: handleGetHtmlStripDynamic,
  RANDOM_NUMBER_MEDIATION: handleGetJsonCanonical,
  COMMODITY_PRICE: handleGetJsonCanonical,
  WEATHER: handleGetJsonCanonical,
  STORAGE: handleStorage,
  LLM_OPEN_QUESTION: handleLlmOpenQuestion,
  LLM_EXTRACT_STRUCTURED: handleLlmExtractStructured,
  LLM_CLASSIFY_DOCUMENT: handleLlmClassifyDocument,
  LLM_RISK_SCORE: handleLlmRiskScore,
  DLVC_VALIDATION: handleTaskDlvcValidation,
  task_DLVC_validation: handleTaskDlvcValidation,
};

export function getTaskHandler(taskType: string): TaskHandler | undefined {
  return handlers[String(taskType ?? "").trim()];
}
