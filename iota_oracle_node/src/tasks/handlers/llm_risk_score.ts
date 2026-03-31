import type { TaskHandler } from "../types";
import { runPdfLlmJsonTask } from "./llm_common";

export const handleLlmRiskScore: TaskHandler = async ({ payload }) => {
  const definition = String(
    payload?.llm?.rules?.score_definition ??
      "0 means low risk and 10000 means very high risk.",
  ).trim();

  const result = await runPdfLlmJsonTask({
    payload,
    objective: "Assign a deterministic integer risk score for the PDF document.",
    extraRules: [
      definition,
      "Return only the numeric scoring object required by the schema.",
      "Use the full 0..10000 range when justified by the document.",
    ],
  });

  return result.canonical;
};
