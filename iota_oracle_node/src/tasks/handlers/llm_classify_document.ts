import type { TaskHandler } from "../types";
import { runPdfLlmJsonTask } from "./llm_common";

export const handleLlmClassifyDocument: TaskHandler = async ({ payload }) => {
  const labels = Array.isArray(payload?.llm?.labels) ? payload.llm.labels.map(String).join(", ") : "the schema enum";
  const wantsConfidence = Object.prototype.hasOwnProperty.call(payload?.llm?.output_schema?.properties ?? {}, "confidence_bps");
  const extraRules = [
    `Choose document_class only from these labels: ${labels}.`,
    "If the document is an unfilled or mostly unfilled form, set is_blank_template to true.",
  ];

  if (wantsConfidence) {
    extraRules.push("Set confidence_bps as an integer between 0 and 10000.");
  }

  const result = await runPdfLlmJsonTask({
    payload,
    objective: "Classify the PDF document into one label and return the target metadata.",
    extraRules,
  });

  return result.canonical;
};
