const EXPECTED_TEMPLATE_BY_TASK_TYPE: Record<string, number> = {
  RANDOM_NUMBER_MEDIATION: 1,
  COMMODITY_PRICE: 2,
  WEATHER: 3,
  STORAGE: 4,
  LLM_EXTRACT_STRUCTURED: 5,
  LLM_CLASSIFY_DOCUMENT: 6,
  LLM_RISK_SCORE: 7,
  DLVC_VALIDATION: 8,
  task_DLVC_validation: 8,
};

function toPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function validateTemplatePolicy(taskTypeRaw: string, payload: any, ctxTemplateId?: number): void {
  const taskType = String(taskTypeRaw ?? "").trim();
  const expectedTemplateId = EXPECTED_TEMPLATE_BY_TASK_TYPE[taskType];
  if (!expectedTemplateId) return;

  const templateIdFromCtx = toPositiveInt(ctxTemplateId);
  const templateIdFromPayload = toPositiveInt(payload?.template_id ?? payload?.templateId);

  if (templateIdFromCtx != null && templateIdFromPayload != null && templateIdFromCtx !== templateIdFromPayload) {
    throw new Error(
      `Template mismatch for ${taskType}: ctx.templateId=${templateIdFromCtx}, payload.template_id=${templateIdFromPayload}`,
    );
  }

  const effectiveTemplateId = templateIdFromCtx ?? templateIdFromPayload;
  if (effectiveTemplateId == null) {
    throw new Error(`Missing template_id for ${taskType}. Expected template_id=${expectedTemplateId}`);
  }
  if (effectiveTemplateId !== expectedTemplateId) {
    throw new Error(
      `Invalid template_id for ${taskType}: got ${effectiveTemplateId}, expected ${expectedTemplateId}`,
    );
  }
}

