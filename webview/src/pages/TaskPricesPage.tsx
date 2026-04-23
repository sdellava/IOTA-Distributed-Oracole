// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { useMemo, useState } from "react";
import type { IotaMarketPriceResponse, OracleTemplateCost } from "../types";

type Props = {
  templates: OracleTemplateCost[];
  systemFeeBps: string | null | undefined;
  iotaMarketPrice: IotaMarketPriceResponse | null;
};

type CurrencyMode = "usd" | "eur";

function parseAtomicIota(value: string | null | undefined): bigint | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

function parseBps(value: string | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function formatNumber(value: number, minimumFractionDigits = 0, maximumFractionDigits = 6): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

function formatCurrency(value: number | null, currency: CurrencyMode): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

function toIotaDisplay(value: string | null | undefined): string {
  const atomic = parseAtomicIota(value);
  if (atomic == null) return "-";
  return `${formatNumber(Number(atomic) / 1_000_000_000, 2, 2)} IOTA`;
}

function toIotaTooltip(value: string | null | undefined): string | undefined {
  const atomic = parseAtomicIota(value);
  if (atomic == null) return undefined;
  return `${formatNumber(Number(atomic) / 1_000_000_000, 8, 8)} IOTA`;
}

function toSelectedCurrencyValue(
  template: OracleTemplateCost,
  systemFeeBps: number,
  market: IotaMarketPriceResponse | null,
  currency: CurrencyMode,
): number | null {
  const totalAtomic = computePerNodeAtomic(template);
  if (totalAtomic == null || !market) return null;

  const grossIota = Number(totalAtomic) / 1_000_000_000;
  const grossUsd = grossIota * market.usdPrice;
  const totalUsd = grossUsd * (1 + systemFeeBps / 10_000);

  return currency === "eur" ? totalUsd * market.usdToEurRate : totalUsd;
}

function computePerNodeAtomic(template: OracleTemplateCost): bigint | null {
  const baseAtomic = parseAtomicIota(template.basePriceIota);
  if (baseAtomic == null) return null;

  const retentionDays = Number(template.minRetentionDays ?? "0");
  const retentionUnitAtomic = parseAtomicIota(template.pricePerRetentionDayIota) ?? 0n;
  const retentionAtomic =
    Number.isFinite(retentionDays) && retentionDays > 0
      ? retentionUnitAtomic * BigInt(Math.floor(retentionDays))
      : 0n;

  return baseAtomic + retentionAtomic;
}

export default function TaskPricesPage({ templates, systemFeeBps, iotaMarketPrice }: Props) {
  const [showEuro, setShowEuro] = useState(false);
  const currency: CurrencyMode = showEuro ? "eur" : "usd";
  const feeBps = useMemo(() => parseBps(systemFeeBps), [systemFeeBps]);

  return (
    <section className="card card-spaced task-prices-page">
      <div className="task-prices-head">
        <div>
          <div className="section-title">Task Prices</div>
          <p className="task-prices-intro">
            One row per approved task template and one column per configured pricing field. The last column shows the
            estimated minimum total price in the selected currency, computed per node from base price plus minimum
            retention cost, with system fee included. Price columns are shown in IOTA.
          </p>
        </div>

        <label className="currency-toggle">
          <input type="checkbox" checked={showEuro} onChange={(event) => setShowEuro(event.target.checked)} />
          <span>Show EUR instead of USD</span>
        </label>
      </div>

      {!templates.length ? (
        <div className="empty">
          No approved task templates found on-chain for this network. Prices will appear here as soon as templates are
          available.
        </div>
      ) : (
        <div className="table-wrap table-wrap-wide">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Task type</th>
                <th>Status</th>
                <th>Base price</th>
                <th>Input bytes max</th>
                <th>Output bytes max</th>
                <th>Included download bytes</th>
                <th>Price / download byte</th>
                <th>Storage</th>
                <th>Min retention days</th>
                <th>Max retention days</th>
                <th>Retention unit cost / day</th>
                <th>Per node</th>
                <th>Estimated min total ({currency.toUpperCase()})</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.templateId}>
                  <td data-label="Template" className="mono">
                    {template.templateId}
                  </td>
                  <td data-label="Task type">{template.taskType || "-"}</td>
                  <td data-label="Status">
                    <span className={`template-status-badge ${template.isEnabled ? "is-on" : "is-off"}`}>
                      {template.isEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td data-label="Base price" className="mono" title={toIotaTooltip(template.basePriceIota)}>
                    {toIotaDisplay(template.basePriceIota)}
                  </td>
                  <td data-label="Input bytes max" className="mono">
                    {template.maxInputBytes ?? "-"}
                  </td>
                  <td data-label="Output bytes max" className="mono">
                    {template.maxOutputBytes ?? "-"}
                  </td>
                  <td data-label="Included download bytes" className="mono">
                    {template.includedDownloadBytes ?? "-"}
                  </td>
                  <td
                    data-label="Price / download byte"
                    className="mono"
                    title={toIotaTooltip(template.pricePerDownloadByteIota)}
                  >
                    {toIotaDisplay(template.pricePerDownloadByteIota)}
                  </td>
                  <td data-label="Storage">{template.allowStorage ? "Yes" : "No"}</td>
                  <td data-label="Min retention days" className="mono">
                    {template.minRetentionDays ?? "-"}
                  </td>
                  <td data-label="Max retention days" className="mono">
                    {template.maxRetentionDays ?? "-"}
                  </td>
                  <td
                    data-label="Retention unit cost / day"
                    className="mono"
                    title={toIotaTooltip(template.pricePerRetentionDayIota)}
                  >
                    {toIotaDisplay(template.pricePerRetentionDayIota)}
                  </td>
                  <td
                    data-label="Per node"
                    className="mono"
                    title={
                      computePerNodeAtomic(template) == null
                        ? undefined
                        : `${formatNumber(Number(computePerNodeAtomic(template)!) / 1_000_000_000, 8, 8)} IOTA`
                    }
                  >
                    {computePerNodeAtomic(template) == null
                      ? "-"
                      : `${formatNumber(Number(computePerNodeAtomic(template)!) / 1_000_000_000, 2, 2)} IOTA`}
                  </td>
                  <td data-label={`Estimated min total (${currency.toUpperCase()})`} className="mono">
                    {formatCurrency(toSelectedCurrencyValue(template, feeBps, iotaMarketPrice, currency), currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="summary-hint">
        Retention unit cost/day is the on-chain storage cost for one day. Per node =
        {" "}base price + (min retention days x retention unit cost/day). Estimated min total applies system fee to
        that per-node amount. System fee: {feeBps} bps. IOTA/USD: {iotaMarketPrice ? iotaMarketPrice.usdPrice.toFixed(8) : "-"}.
        {" "}
        USD/EUR: {iotaMarketPrice ? iotaMarketPrice.usdToEurRate.toFixed(4) : "-"}.
      </div>
    </section>
  );
}
