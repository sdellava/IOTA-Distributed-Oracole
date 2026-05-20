// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { useMemo, useState } from "react";
import type { IotaMarketPriceResponse, OracleTemplateCost } from "../types";

type Props = {
  templates: OracleTemplateCost[];
  systemFeeBps: string | null | undefined;
  minPayment: string | null | undefined;
  iotaMarketPrice: IotaMarketPriceResponse | null;
};

type CurrencyMode = "usd" | "eur";

type TemplateQuote = {
  base: bigint | null;
  downloadUnit: bigint;
  retentionUnit: bigint;
  schedulerFee: bigint;
  minPayment: bigint;
  requestedNodes: bigint;
  declaredDownloadBytes: bigint;
  extraDownloadBytes: bigint;
  downloadCost: bigint;
  retentionDays: bigint;
  retentionCost: bigint;
  perNodeRaw: bigint | null;
  rawTask: bigint | null;
  systemFee: bigint | null;
  totalBeforeFloor: bigint | null;
  requiredPayment: bigint | null;
  directTotal: bigint | null;
  scheduledPerRun: bigint | null;
  scheduledBudget: bigint | null;
  validRuntime: boolean;
  runtimeWarning: string | null;
};

const IOTA_DECIMALS = 1_000_000_000;

function parseAtomicIota(value: string | null | undefined): bigint | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

function parseBps(value: string | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function parseU64(value: string | null | undefined): bigint {
  const parsed = parseAtomicIota(value);
  return parsed ?? 0n;
}

function parsePositiveInput(value: string, fallback: bigint): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  const parsed = BigInt(trimmed);
  return parsed > 0n ? parsed : fallback;
}

function parseNonNegativeInput(value: string, fallback = 0n): bigint {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return fallback;
  return BigInt(trimmed);
}

function formatNumber(value: number, minimumFractionDigits = 0, maximumFractionDigits = 6): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

function formatInteger(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  return n.toLocaleString();
}

function formatRetentionRange(template: OracleTemplateCost): string {
  const min = formatInteger(template.minRetentionDays);
  const max = formatInteger(template.maxRetentionDays);
  return `${min} min / ${max} max`;
}

function formatBpsPercent(bps: number): string {
  return `${formatNumber(bps / 100, 0, 2)}%`;
}

function formatIotaAtomic(value: bigint | null | undefined, digits = 6): string {
  if (value == null) return "-";
  return `${formatNumber(Number(value) / IOTA_DECIMALS, 0, digits)} IOTA`;
}

function formatCurrency(value: bigint | null, market: IotaMarketPriceResponse | null, currency: CurrencyMode): string {
  if (value == null || !market) return "-";
  const iota = Number(value) / IOTA_DECIMALS;
  const usd = iota * market.usdPrice;
  const selected = currency === "eur" ? usd * market.usdToEurRate : usd;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: selected < 1 ? 6 : 2,
  }).format(selected);
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) return 0n;
  return (value + divisor - 1n) / divisor;
}

function computeTemplateQuote(
  template: OracleTemplateCost,
  systemFeeBps: number,
  minPayment: bigint,
  runtime: {
    requestedNodes: bigint;
    declaredDownloadBytes: bigint;
    retentionDays: bigint;
    scheduledRuns: bigint;
  },
): TemplateQuote {
  const base = parseAtomicIota(template.basePriceIota);
  const downloadUnit = parseU64(template.pricePerDownloadByteIota);
  const retentionUnit = parseU64(template.pricePerRetentionDayIota);
  const schedulerFee = parseU64(template.schedulerFeeIota);
  const includedDownloadBytes = parseU64(template.includedDownloadBytes);
  const minRetentionDays = parseU64(template.minRetentionDays);
  const maxRetentionDays = parseU64(template.maxRetentionDays);
  const retentionDays = template.allowStorage ? runtime.retentionDays : 0n;
  const extraDownloadBytes =
    runtime.declaredDownloadBytes > includedDownloadBytes ? runtime.declaredDownloadBytes - includedDownloadBytes : 0n;
  const downloadCost = extraDownloadBytes * downloadUnit;
  const retentionCost = retentionDays * retentionUnit;
  const retentionValid =
    !template.allowStorage ||
    (retentionDays >= minRetentionDays && (maxRetentionDays === 0n || retentionDays <= maxRetentionDays));
  const runtimeWarning = retentionValid
    ? null
    : maxRetentionDays === minRetentionDays
      ? `Retention must be exactly ${minRetentionDays.toString()} day(s) for this template.`
      : `Retention must be between ${minRetentionDays.toString()} and ${maxRetentionDays.toString()} day(s).`;

  if (base == null) {
    return {
      base,
      downloadUnit,
      retentionUnit,
      schedulerFee,
      minPayment,
      requestedNodes: runtime.requestedNodes,
      declaredDownloadBytes: runtime.declaredDownloadBytes,
      extraDownloadBytes,
      downloadCost,
      retentionDays,
      retentionCost,
      perNodeRaw: null,
      rawTask: null,
      systemFee: null,
      totalBeforeFloor: null,
      requiredPayment: null,
      directTotal: null,
      scheduledPerRun: null,
      scheduledBudget: null,
      validRuntime: retentionValid,
      runtimeWarning,
    };
  }

  const perNodeRaw = base + downloadCost + retentionCost;
  const rawTask = perNodeRaw * runtime.requestedNodes;
  const systemFee = systemFeeBps > 0 ? ceilDiv(rawTask * BigInt(systemFeeBps), 10_000n) : 0n;
  const totalBeforeFloor = rawTask + systemFee;
  const requiredPayment = totalBeforeFloor > minPayment ? totalBeforeFloor : minPayment;
  const directTotal = requiredPayment;
  const scheduledPerRun = requiredPayment + schedulerFee;
  const scheduledBudget = scheduledPerRun * runtime.scheduledRuns;

  return {
    base,
    downloadUnit,
    retentionUnit,
    schedulerFee,
    minPayment,
    requestedNodes: runtime.requestedNodes,
    declaredDownloadBytes: runtime.declaredDownloadBytes,
    extraDownloadBytes,
    downloadCost,
    retentionDays,
    retentionCost,
    perNodeRaw,
    rawTask,
    systemFee,
    totalBeforeFloor,
    requiredPayment,
    directTotal,
    scheduledPerRun,
    scheduledBudget,
    validRuntime: retentionValid,
    runtimeWarning,
  };
}

function CostItem({
  label,
  value,
  hint,
  tone = "normal",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "normal" | "accent" | "muted";
}) {
  return (
    <div className={`price-component price-component-${tone}`}>
      <div className="template-kv-label">{label}</div>
      <div className="template-kv-value mono">{value}</div>
      {hint ? <div className="summary-hint">{hint}</div> : null}
    </div>
  );
}

export default function TaskPricesPage({ templates, systemFeeBps, minPayment, iotaMarketPrice }: Props) {
  const [showEuro, setShowEuro] = useState(false);
  const [requestedNodes, setRequestedNodes] = useState("1");
  const [declaredDownloadBytes, setDeclaredDownloadBytes] = useState("0");
  const [retentionDays, setRetentionDays] = useState("30");
  const [scheduledRuns, setScheduledRuns] = useState("2");
  const currency: CurrencyMode = showEuro ? "eur" : "usd";
  const feeBps = useMemo(() => parseBps(systemFeeBps), [systemFeeBps]);
  const minPaymentAtomic = useMemo(() => parseU64(minPayment), [minPayment]);
  const runtime = useMemo(
    () => ({
      requestedNodes: parsePositiveInput(requestedNodes, 1n),
      declaredDownloadBytes: parseNonNegativeInput(declaredDownloadBytes),
      retentionDays: parseNonNegativeInput(retentionDays, 30n),
      scheduledRuns: parsePositiveInput(scheduledRuns, 1n),
    }),
    [declaredDownloadBytes, requestedNodes, retentionDays, scheduledRuns],
  );

  return (
    <section className="card card-spaced task-prices-page">
      <div className="task-prices-head">
        <div>
          <div className="section-title">Task Prices</div>
          <p className="task-prices-intro">
            The page shows the complete pricing model used by task creation. Template values are fixed on-chain; runtime
            values such as requested nodes, declared download bytes, retention days, and run count are applied when a
            specific task is prepared.
          </p>
        </div>

        <label className="currency-toggle">
          <input type="checkbox" checked={showEuro} onChange={(event) => setShowEuro(event.target.checked)} />
          <span>Show EUR instead of USD</span>
        </label>
      </div>

      <div className="price-formula-panel">
        <div className="subsection-title">Pricing formula</div>
        <div className="price-formula-grid">
          <CostItem
            label="Per-node raw"
            value="base + download + retention"
            hint="download = extra bytes x unit price; retention = days x day price"
            tone="accent"
          />
          <CostItem label="Raw task" value="per-node raw x requested nodes" />
          <CostItem label="System fee" value="ceil(raw task x fee bps / 10000)" />
          <CostItem label="Required payment" value="max(raw task + system fee, min payment)" tone="accent" />
          <CostItem label="Direct one-shot" value="required payment" />
          <CostItem label="Scheduled run" value="required payment + scheduler fee" />
        </div>
        <div className="summary-hint">
          Current global system fee: <span className="mono">{feeBps} bps</span>. Minimum payment:{" "}
          <span className="mono">{formatIotaAtomic(minPaymentAtomic)}</span>. IOTA/USD:{" "}
          <span className="mono">{iotaMarketPrice ? iotaMarketPrice.usdPrice.toFixed(8) : "-"}</span>. USD/EUR:{" "}
          <span className="mono">{iotaMarketPrice ? iotaMarketPrice.usdToEurRate.toFixed(4) : "-"}</span>.
        </div>
      </div>

      <div className="price-formula-panel">
        <div className="subsection-title">Runtime parameters</div>
        <div className="price-input-grid">
          <label className="schedule-field">
            Requested nodes
            <input
              type="number"
              min="1"
              step="1"
              value={requestedNodes}
              onChange={(event) => setRequestedNodes(event.target.value)}
            />
          </label>
          <label className="schedule-field">
            Declared download bytes
            <input
              type="number"
              min="0"
              step="1"
              value={declaredDownloadBytes}
              onChange={(event) => setDeclaredDownloadBytes(event.target.value)}
            />
          </label>
          <label className="schedule-field">
            Retention days
            <input
              type="number"
              min="0"
              step="1"
              value={retentionDays}
              onChange={(event) => setRetentionDays(event.target.value)}
            />
          </label>
          <label className="schedule-field">
            Scheduled runs
            <input
              type="number"
              min="1"
              step="1"
              value={scheduledRuns}
              onChange={(event) => setScheduledRuns(event.target.value)}
            />
          </label>
          <div className="price-readonly-field">
            <div className="template-kv-label">System fee</div>
            <div className="template-kv-value mono">
              {feeBps} bps ({formatBpsPercent(feeBps)})
            </div>
            <div className="summary-hint">Paid to the OracleTreasury.</div>
          </div>
          <div className="price-readonly-field">
            <div className="template-kv-label">Minimum payment</div>
            <div className="template-kv-value mono">{formatIotaAtomic(minPaymentAtomic)}</div>
            <div className="summary-hint">Floor applied after raw task + system fee.</div>
          </div>
        </div>
        <div className="summary-hint">
          These values are used below to calculate the exact task cost for each template. Retention is ignored for
          non-storage templates.
        </div>
      </div>

      {!templates.length ? (
        <div className="empty">
          No approved task templates found on-chain for this network. Prices will appear here as soon as templates are
          available.
        </div>
      ) : (
        <div className="price-template-list">
          {templates.map((template) => {
            const quote = computeTemplateQuote(template, feeBps, minPaymentAtomic, runtime);
            return (
              <article className="price-template-card" key={template.templateId}>
                <div className="price-template-head">
                  <div>
                    <div className="template-kv-label">Template</div>
                    <div className="price-template-title">
                      <span className="mono">{template.templateId}</span>
                      <span>{template.taskType || "-"}</span>
                    </div>
                  </div>
                  <span className={`template-status-badge ${template.isEnabled ? "is-on" : "is-off"}`}>
                    {template.isEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                {quote.runtimeWarning ? <div className="alert alert-warn">{quote.runtimeWarning}</div> : null}

                <div className="price-component-grid">
                  <CostItem
                    label="Base price"
                    value={formatIotaAtomic(quote.base)}
                    hint="Fixed base amount for one node execution."
                  />
                  <CostItem
                    label="Scheduler fee"
                    value={formatIotaAtomic(quote.schedulerFee)}
                    hint="Added only to each scheduled run, not to direct one-shot tasks."
                  />
                  <CostItem
                    label="Input bytes max"
                    value={formatInteger(template.maxInputBytes)}
                    hint="Maximum accepted payload size for this template."
                    tone="muted"
                  />
                  <CostItem
                    label="Output bytes max"
                    value={formatInteger(template.maxOutputBytes)}
                    hint="Maximum declared output/download size."
                    tone="muted"
                  />
                  <CostItem
                    label="Included download bytes"
                    value={formatInteger(template.includedDownloadBytes)}
                    hint="Bytes included before extra download pricing starts."
                  />
                  <CostItem
                    label="Price per extra byte"
                    value={formatIotaAtomic(quote.downloadUnit, 9)}
                    hint="Applied to max(0, declared bytes - included bytes)."
                  />
                  <CostItem
                    label="Extra download bytes"
                    value={quote.extraDownloadBytes.toLocaleString()}
                    hint="Runtime declared bytes minus included bytes, floored at zero."
                  />
                  <CostItem
                    label="Download cost"
                    value={formatIotaAtomic(quote.downloadCost)}
                    hint="Extra download bytes x price per extra byte."
                  />
                  <CostItem
                    label="Storage"
                    value={template.allowStorage ? "Allowed" : "Not allowed"}
                    hint="Controls whether retention pricing can be used."
                    tone={template.allowStorage ? "accent" : "muted"}
                  />
                  <CostItem
                    label="Retention days"
                    value={formatRetentionRange(template)}
                    hint="Runtime retention_days must stay inside this range."
                  />
                  <CostItem
                    label="Retention price/day"
                    value={formatIotaAtomic(quote.retentionUnit)}
                    hint="Multiplied by task retention_days."
                  />
                  <CostItem
                    label="Retention cost"
                    value={formatIotaAtomic(quote.retentionCost)}
                    hint={`${quote.retentionDays.toString()} day(s) x retention price/day.`}
                  />
                  <CostItem
                    label="Per-node raw"
                    value={formatIotaAtomic(quote.perNodeRaw)}
                    hint="Base price + download cost + retention cost."
                    tone="accent"
                  />
                  <CostItem
                    label="Raw task"
                    value={formatIotaAtomic(quote.rawTask)}
                    hint={`${quote.requestedNodes.toString()} requested node(s) x per-node raw.`}
                    tone="accent"
                  />
                  <CostItem
                    label="System fee"
                    value={formatIotaAtomic(quote.systemFee)}
                    hint={`${feeBps} bps rounded up on raw task price.`}
                  />
                  <CostItem
                    label="Required payment"
                    value={formatIotaAtomic(quote.requiredPayment)}
                    hint={`After min payment floor: ${formatIotaAtomic(quote.minPayment)}.`}
                    tone="accent"
                  />
                  <CostItem
                    label="Direct one-shot total"
                    value={formatIotaAtomic(quote.directTotal)}
                    hint={formatCurrency(quote.directTotal, iotaMarketPrice, currency)}
                    tone="accent"
                  />
                  <CostItem
                    label="Scheduled per-run"
                    value={formatIotaAtomic(quote.scheduledPerRun)}
                    hint={formatCurrency(quote.scheduledPerRun, iotaMarketPrice, currency)}
                    tone="accent"
                  />
                  <CostItem
                    label="Scheduled budget"
                    value={formatIotaAtomic(quote.scheduledBudget)}
                    hint={`${runtime.scheduledRuns.toString()} run(s) x scheduled per-run.`}
                    tone="accent"
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="summary-hint">
        Direct one-shot tasks pay only the required payment. Scheduled tasks add the scheduler fee to every run and the
        required initial budget is the scheduled per-run amount multiplied by the selected number of runs.
      </div>
    </section>
  );
}
