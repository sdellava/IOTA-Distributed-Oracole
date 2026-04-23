// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { TaskHandler } from "../types";
import { callLlmJson } from "../utils/llm";

const DEFAULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["question", "answer"],
  properties: {
    question: { type: "string" },
    answer: { type: "string" },
  },
};

function resolveQuestion(payload: any): string {
  const candidates = [
    payload?.question,
    payload?.input?.question,
    payload?.request?.question,
    payload?.llm?.question,
  ];

  for (const candidate of candidates) {
    const question = String(candidate ?? "").trim();
    if (question) return question;
  }

  throw new Error("Missing question for LLM_OPEN_QUESTION. Expected payload.question");
}

function resolveSchema(payload: any) {
  const schema = payload?.llm?.output_schema;
  if (!schema || typeof schema !== "object") return DEFAULT_SCHEMA;
  return schema;
}

function buildDefaultPrompt(question: string): string {
  return [
    "You are a deterministic question-answering engine with access to up-to-date web information.",
    "",
    "Your job:",
    "- Find the answer to the user's question using current reliable sources.",
    "- Return exactly one JSON object.",
    "",
    "Important:",
    "- The example below only shows the required output format.",
    "- Do not copy, reuse, or infer the answer from the example.",
    "- You must answer the actual user question.",
    "",
    "Output rules:",
    "1. Return exactly one JSON object.",
    "2. Do not include markdown fences.",
    "3. Do not include explanations, notes, reasoning, sources, or extra text.",
    '4. The JSON object must contain exactly these two string fields:',
    '   - "question"',
    '   - "answer"',
    "5. Copy the user question exactly as provided.",
    '6. The "answer" field must contain only the final short answer.',
    "7. Use current information when the question depends on recent events.",
    "8. Prefer official sources when available.",
    '9. If the answer cannot be determined after checking current sources, return an empty string for "answer".',
    "",
    "Format example only:",
    '{"question":"example question","answer":"example short answer"}',
    "",
    "User question:",
    question,
  ].join("\n");
}

export const handleLlmOpenQuestion: TaskHandler = async ({ payload }) => {
  const question = resolveQuestion(payload);
  const schema = resolveSchema(payload);
  const prompt = String(payload?.llm?.prompt ?? "").trim() || buildDefaultPrompt(question);

  const result = await callLlmJson({
    taskName: String(payload?.type ?? "LLM_OPEN_QUESTION"),
    prompt,
    schema,
    llmConfig: payload?.llm,
    normalization: payload?.normalization ?? { canonical: true, dropNulls: false, sortArrays: true },
  });

  return result.canonical;
};
