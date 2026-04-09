import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ConnectButton, useCurrentAccount } from "@iota/dapp-kit";
import Menu, { Item as RcMenuItem, Divider } from "rc-menu";
import ActivityTable from "./components/ActivityTable";
import MetricCard from "./components/MetricCard";
import TaskRunner from "./components/TaskRunner";
import { fetchExamples, fetchIotaMarketPrice, fetchNetworkConfig, fetchStatus, updateActiveNetwork } from "./lib/api";
import type { ExampleTask, IotaMarketPriceResponse, OracleNetwork, OracleStatus, OracleTemplateCost } from "./types";
import ValidateTaskPage from "./pages/ValidateTaskPage";

const REFRESH_MS = 10_000;

type PageMode = "run" | "validate";
const FALLBACK_NETWORKS: OracleNetwork[] = ["mainnet", "testnet", "devnet"];

function normalizeNetwork(value: string | null | undefined): OracleNetwork {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "devnet" || raw === "dev") return "devnet";
  if (raw === "testnet" || raw === "test") return "testnet";
  return "mainnet";
}

function shortAddress(address: string, start = 6, end = 4): string {
  if (!address) return "-";
  if (address.length <= start + end + 3) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

function parseIotaAtomic(value: string | null | undefined): bigint | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

function formatUsd(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

function formatIotaAtomic(value: bigint): string {
  return (Number(value) / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function parseBps(value: string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function profileLine(
  label: string,
  atomicValue: string | null | undefined,
  iotaUsdPrice: number | null,
  treasuryBps: number,
): string | null {
  if (iotaUsdPrice == null || iotaUsdPrice <= 0) return null;
  const atomic = parseIotaAtomic(atomicValue);
  if (atomic == null || atomic === 0n) return null;

  const iota = Number(atomic) / 1_000_000_000;
  const grossUsd = iota * iotaUsdPrice;
  const treasuryUsd = grossUsd * (treasuryBps / 10_000);
  const netUsd = grossUsd - treasuryUsd;

  return `${label}: gross $${formatUsd(grossUsd)}, treasury $${formatUsd(treasuryUsd)}, net $${formatUsd(netUsd)}`;
}

function formatPriceProfile(template: OracleTemplateCost, iotaUsdPrice: number | null, treasuryBps: number): string {
  const parts = [
    profileLine("base", template.basePriceIota, iotaUsdPrice, treasuryBps),
    profileLine("download/byte", template.pricePerDownloadByteIota, iotaUsdPrice, treasuryBps),
    profileLine("retention/day", template.pricePerRetentionDayIota, iotaUsdPrice, treasuryBps),
    profileLine(
      "retention/month (30d)",
      (() => {
        const retention = parseIotaAtomic(template.pricePerRetentionDayIota);
        return retention == null ? null : (retention * 30n).toString();
      })(),
      iotaUsdPrice,
      treasuryBps,
    ),
  ].filter(Boolean) as string[];

  return parts.length ? parts.join(" | ") : "-";
}

function buildMonthlyStorageEstimate(
  template: OracleTemplateCost,
  treasuryBps: number,
  iotaUsdPrice: number | null,
): {
  storageMonthlyAtomic: bigint;
  rawAtomic: bigint;
  feeAtomic: bigint;
  totalAtomic: bigint;
  summary: string;
} | null {
  if (!template.allowStorage) return null;

  const baseAtomic = parseIotaAtomic(template.basePriceIota);
  const perDayAtomic = parseIotaAtomic(template.pricePerRetentionDayIota);
  if (baseAtomic == null || perDayAtomic == null) return null;

  const storageMonthlyAtomic = perDayAtomic * 30n;
  const rawAtomic = baseAtomic + storageMonthlyAtomic;
  const feeAtomic = (rawAtomic * BigInt(Math.max(0, treasuryBps)) + 9_999n) / 10_000n;
  const totalAtomic = rawAtomic + feeAtomic;

  const usdPart =
    iotaUsdPrice && iotaUsdPrice > 0
      ? ` | total ~= $${formatUsd((Number(totalAtomic) / 1_000_000_000) * iotaUsdPrice)}`
      : "";

  return {
    storageMonthlyAtomic,
    rawAtomic,
    feeAtomic,
    totalAtomic,
    summary:
      `base ${formatIotaAtomic(baseAtomic)} IOTA + storage 30d ${formatIotaAtomic(storageMonthlyAtomic)} IOTA + fee ${formatIotaAtomic(feeAtomic)} IOTA = total ${formatIotaAtomic(totalAtomic)} IOTA` +
      usdPart,
  };
}

function templateLabel(template: OracleTemplateCost): string {
  return template.taskType ? `${template.templateId} - ${template.taskType}` : template.templateId;
}

export default function App() {
  const [status, setStatus] = useState<OracleStatus | null>(null);
  const [examples, setExamples] = useState<ExampleTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentAccount = useCurrentAccount();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [pageMode, setPageMode] = useState<PageMode>("run");
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportedNetworks, setSupportedNetworks] = useState<OracleNetwork[]>(FALLBACK_NETWORKS);
  const [activeNetwork, setActiveNetworkState] = useState<OracleNetwork>("mainnet");
  const [networkLoading, setNetworkLoading] = useState(false);
  const [iotaMarketPrice, setIotaMarketPrice] = useState<IotaMarketPriceResponse | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hostingText = import.meta.env.VITE_HOSTING_TEXT?.trim() || "";
  const themeStyle = {
    "--theme-page-bg": import.meta.env.VITE_THEME_PAGE_BG?.trim() || "#0b1020",
    "--theme-text": import.meta.env.VITE_THEME_TEXT?.trim() || "#ebeff8",
    "--theme-muted-text": import.meta.env.VITE_THEME_MUTED_TEXT?.trim() || "#aab6d3",
    "--theme-accent-text": import.meta.env.VITE_THEME_ACCENT_TEXT?.trim() || "#8fa2d0",
    "--theme-card-bg": import.meta.env.VITE_THEME_CARD_BG?.trim() || "rgba(12, 18, 36, 0.88)",
    "--theme-card-border": import.meta.env.VITE_THEME_CARD_BORDER?.trim() || "rgba(143, 162, 208, 0.14)",
    "--theme-input-bg": import.meta.env.VITE_THEME_INPUT_BG?.trim() || "#0f1730",
    "--theme-input-border": import.meta.env.VITE_THEME_INPUT_BORDER?.trim() || "rgba(143, 162, 208, 0.18)",
    "--theme-primary-bg": import.meta.env.VITE_THEME_PRIMARY_BG?.trim() || "#121e3d",
    "--theme-primary-text": import.meta.env.VITE_THEME_PRIMARY_TEXT?.trim() || "#d8e2f7",
  } as CSSProperties;

  useEffect(() => {
    const root = document.documentElement;
    const entries = Object.entries(themeStyle).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    for (const [key, value] of entries) {
      root.style.setProperty(key, value);
    }
  }, [themeStyle]);

  async function refreshStatus() {
    try {
      const data = await fetchStatus();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshIotaPrice() {
    try {
      const data = await fetchIotaMarketPrice();
      setIotaMarketPrice(data);
    } catch {
      // Keep previous value if market API is temporarily unavailable.
    }
  }

  useEffect(() => {
    async function init() {
      try {
        const networkConfig = await fetchNetworkConfig();
        const supported = (
          networkConfig.supportedNetworks?.length ? networkConfig.supportedNetworks : FALLBACK_NETWORKS
        ).map((item) => normalizeNetwork(item));
        setSupportedNetworks(Array.from(new Set(supported)));
        setActiveNetworkState(normalizeNetwork(networkConfig.activeNetwork));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      await refreshIotaPrice();
      await refreshStatus();
    }

    void init();
    const statusTimer = window.setInterval(() => void refreshStatus(), REFRESH_MS);
    const priceTimer = window.setInterval(() => void refreshIotaPrice(), REFRESH_MS);
    return () => {
      window.clearInterval(statusTimer);
      window.clearInterval(priceTimer);
    };
  }, []);

  useEffect(() => {
    fetchExamples()
      .then(setExamples)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const lastRefreshText = useMemo(() => {
    if (!status?.lastRefreshIso) return "-";
    return new Date(status.lastRefreshIso).toLocaleString();
  }, [status?.lastRefreshIso]);

  const availableTemplates = status?.costs.templates ?? [];

  const selectedTemplate = useMemo(() => {
    if (!selectedTemplateId) return null;
    return availableTemplates.find((template) => template.templateId === selectedTemplateId) ?? null;
  }, [availableTemplates, selectedTemplateId]);

  const iotaPriceText = useMemo(() => {
    if (!iotaMarketPrice) return "IOTA price unavailable";
    return `1 IOTA = $${iotaMarketPrice.usdPrice.toFixed(8)} USD`;
  }, [iotaMarketPrice]);

  const iotaPriceUpdatedText = useMemo(() => {
    if (!iotaMarketPrice?.fetchedAtIso) return "-";
    return new Date(iotaMarketPrice.fetchedAtIso).toLocaleString();
  }, [iotaMarketPrice?.fetchedAtIso]);

  const selectedTemplateMonthlyEstimate = useMemo(
    () =>
      selectedTemplate
        ? buildMonthlyStorageEstimate(
            selectedTemplate,
            parseBps(status?.costs.systemFeeBps ?? null),
            iotaMarketPrice?.usdPrice ?? null,
          )
        : null,
    [selectedTemplate, status?.costs.systemFeeBps, iotaMarketPrice?.usdPrice],
  );

  async function onNetworkChange(nextValue: string) {
    const next = normalizeNetwork(nextValue);
    if (next === activeNetwork) return;

    setNetworkLoading(true);
    try {
      const networkConfig = await updateActiveNetwork(next);
      setActiveNetworkState(normalizeNetwork(networkConfig.activeNetwork));
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setNetworkLoading(false);
    }
  }

  return (
    <div className="page" style={themeStyle}>
      <header className="hero card">
        <div className="hero-top">
          <div className="hero-main">
            <h1>IOTA Distributed Oracle</h1>
            {hostingText ? <p className="hero-hosting-text">{hostingText}</p> : null}
          </div>

          <div className="hero-side">
            <div className="wallet-toolbar">
              <div className="wallet-top-row">
                <div className="page-switcher" ref={menuRef}>
                  <button
                    type="button"
                    className="page-switcher-trigger"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((prev) => !prev)}
                  >
                    Menu
                  </button>
                  {menuOpen ? (
                    <div className="page-switcher-popup">
                      <Menu
                        mode="vertical"
                        selectedKeys={[pageMode]}
                        className="page-switcher-popup-menu"
                        onClick={({ key }) => {
                          if (key === "run" || key === "validate") {
                            setPageMode(key);
                            setMenuOpen(false);
                          }
                        }}
                      >
                        <RcMenuItem key="run">Run task</RcMenuItem>
                        <Divider />
                        <RcMenuItem key="validate">Validate task</RcMenuItem>
                      </Menu>
                    </div>
                  ) : null}
                </div>
                <label className="network-select-wrap" title="IOTA network">
                  <span className="sr-only">Network</span>
                  <select
                    className="network-select"
                    value={activeNetwork}
                    onChange={(event) => void onNetworkChange(event.target.value)}
                    disabled={networkLoading}
                  >
                    {supportedNetworks.map((network) => (
                      <option key={network} value={network}>
                        {network.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="wallet-connect">
                  <ConnectButton connectText="Connect Wallet" />
                </div>
              </div>
              <div className="wallet-status">
                {currentAccount ? (
                  <>
                    <span className="wallet-status-label">Connected:</span>{" "}
                    <span className="mono">{shortAddress(currentAccount.address)}</span>
                  </>
                ) : (
                  "No wallet connected"
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="hero-meta hero-meta-horizontal">
          <div className="hero-meta-item">
            <strong>Last refresh:</strong> {lastRefreshText}
          </div>
          <div className="hero-meta-item">
            <strong>Mode:</strong> {status?.mode ?? "-"}
          </div>
          <div className="hero-meta-item">
            <strong>RPC:</strong> <span className="mono">{status?.rpcUrl ?? "-"}</span>
          </div>
          <div className="hero-meta-item">
            <strong>Tasks package:</strong>{" "}
            <span className="mono">{status?.tasksPackageId ?? status?.packageId ?? "-"}</span>
          </div>
          <div className="hero-meta-item">
            <strong>System package:</strong> <span className="mono">{status?.systemPackageId ?? "-"}</span>
          </div>
          <div className="hero-meta-item">
            <strong>State:</strong> <span className="mono">{status?.stateId ?? "-"}</span>
          </div>
        </div>
      </header>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {status?.warnings?.length ? (
        <div className="alert alert-warn">
          {status.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      {pageMode === "run" ? (
        <>
          <section className="grid metrics-grid">
            <MetricCard
              label="Active nodes"
              value={status?.metrics.activeNodes ?? "-"}
              hint={`Window: ${status?.activeWindowMinutes ?? "-"} min`}
            />
            <MetricCard label="Known nodes" value={status?.metrics.knownNodes ?? "-"} hint="From env or inferred" />
            <MetricCard label="Inactive known nodes" value={status?.metrics.inactiveKnownNodes ?? "-"} />
            <MetricCard label="On-chain task objects" value={status?.metrics.onChainTaskObjects ?? "-"} hint="" />
            <MetricCard
              label="Latest checkpoint"
              value={status?.latestCheckpoint ?? "-"}
              hint={loading ? "Refreshing..." : "On-chain"}
            />
          </section>

          <TaskRunner
            examples={examples}
            activeNetwork={activeNetwork}
            registeredNodes={status?.registeredNodes ?? []}
            onExecuted={() => void refreshStatus()}
            onTemplateIdChange={setSelectedTemplateId}
          />

          <section className="card card-spaced">
            <div className="section-title">Configured costs</div>

            <div className="table-wrap">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Global setting</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td data-label="Global setting">System fee</td>
                    <td data-label="Value">{status?.costs.systemFeeBps ?? "-"}</td>
                  </tr>
                  <tr>
                    <td data-label="Global setting">Minimum payment</td>
                    <td data-label="Value">{status?.costs.minPayment ?? "-"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="subsection-title" style={{ marginTop: 18 }}>
              Task templates
            </div>
            {!availableTemplates.length ? (
              <div className="empty">No task template costs found.</div>
            ) : !selectedTemplateId ? (
              <div className="template-empty-state">Select or load a task template to view its pricing details.</div>
            ) : !selectedTemplate ? (
              <div className="template-empty-state">
                Template <span className="mono">{selectedTemplateId}</span> is not available on this network.
              </div>
            ) : (
              <div className="template-details-card">
                <div className="template-details-head">
                  <span className="template-details-title">{templateLabel(selectedTemplate)}</span>
                  <span className={`template-status-badge ${selectedTemplate.isEnabled ? "is-on" : "is-off"}`}>
                    {selectedTemplate.isEnabled ? "Enabled" : "Disabled"}
                  </span>
                </div>
                <div className="template-details-grid">
                  <div className="template-kv-item">
                    <span className="template-kv-label">Base price</span>
                    <span className="template-kv-value mono">{selectedTemplate.basePriceIota ?? "-"}</span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Storage</span>
                    <span className="template-kv-value">{selectedTemplate.allowStorage ? "yes" : "no"}</span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Input bytes max</span>
                    <span className="template-kv-value mono">{selectedTemplate.maxInputBytes ?? "-"}</span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Output bytes max</span>
                    <span className="template-kv-value mono">{selectedTemplate.maxOutputBytes ?? "-"}</span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Included download bytes</span>
                    <span className="template-kv-value mono">{selectedTemplate.includedDownloadBytes ?? "-"}</span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Price / download byte</span>
                    <span className="template-kv-value mono">{selectedTemplate.pricePerDownloadByteIota ?? "-"}</span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Min retention days</span>
                    <span className="template-kv-value mono">{selectedTemplate.minRetentionDays ?? "-"}</span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Max retention days</span>
                    <span className="template-kv-value mono">{selectedTemplate.maxRetentionDays ?? "-"}</span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Price / retention day</span>
                    <span className="template-kv-value mono">{selectedTemplate.pricePerRetentionDayIota ?? "-"}</span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Storage / month (30d)</span>
                    <span className="template-kv-value mono">
                      {selectedTemplateMonthlyEstimate
                        ? `${selectedTemplateMonthlyEstimate.storageMonthlyAtomic.toString()} (${formatIotaAtomic(selectedTemplateMonthlyEstimate.storageMonthlyAtomic)} IOTA)`
                        : "-"}
                    </span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">IPFS task total / month (30d, no extra download)</span>
                    <span className="template-kv-value">
                      {selectedTemplateMonthlyEstimate ? selectedTemplateMonthlyEstimate.summary : "-"}
                    </span>
                  </div>
                  <div className="template-kv-item">
                    <span className="template-kv-label">Price profile (USD)</span>
                    <span className="template-kv-value">
                      {formatPriceProfile(
                        selectedTemplate,
                        iotaMarketPrice?.usdPrice ?? null,
                        parseBps(status?.costs.systemFeeBps ?? null),
                      )}
                    </span>
                  </div>
                </div>
                <div className="template-price-profile">
                  <div className="template-kv-label">IOTA current price</div>
                  <div className="template-kv-value">{iotaPriceText}</div>
                  <div className="summary-hint" style={{ marginTop: 8 }}>
                    Source:{" "}
                    <a
                      href={iotaMarketPrice?.sourceUrl ?? "https://coinmarketcap.com/currencies/iota/"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      CoinMarketCap
                    </a>
                    {" • "}
                    Updated: {iotaPriceUpdatedText}
                  </div>
                </div>
              </div>
            )}
          </section>

          <ActivityTable
            nodes={status?.nodeActivity ?? []}
            events={status?.recentEvents ?? []}
            activeNetwork={activeNetwork}
          />
        </>
      ) : (
        <ValidateTaskPage />
      )}
    </div>
  );
}
