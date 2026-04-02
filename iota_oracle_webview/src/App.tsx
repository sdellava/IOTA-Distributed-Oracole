import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ConnectButton, useCurrentAccount } from "@iota/dapp-kit";
import Menu, { Item as RcMenuItem, Divider } from "rc-menu";
import ActivityTable from "./components/ActivityTable";
import MetricCard from "./components/MetricCard";
import TaskRunner from "./components/TaskRunner";
import { fetchExamples, fetchNetworkConfig, fetchStatus, updateActiveNetwork } from "./lib/api";
import type { ExampleTask, OracleNetwork, OracleStatus, OracleTemplateCost } from "./types";
import ValidateTaskPage from "./pages/ValidateTaskPage";

const REFRESH_MS = 10_000;
const IOTA_USD_PRICE = 0.05;
const TREASURY_BPS = 500;

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

function profileLine(label: string, atomicValue: string | null | undefined): string | null {
  const atomic = parseIotaAtomic(atomicValue);
  if (atomic == null || atomic === 0n) return null;

  const iota = Number(atomic) / 1_000_000_000;
  const grossUsd = iota * IOTA_USD_PRICE;
  const treasuryUsd = grossUsd * (TREASURY_BPS / 10_000);
  const netUsd = grossUsd - treasuryUsd;

  return `${label}: gross $${formatUsd(grossUsd)}, treasury $${formatUsd(treasuryUsd)}, net $${formatUsd(netUsd)}`;
}

function formatPriceProfile(template: OracleTemplateCost): string {
  const parts = [
    profileLine("base", template.basePriceIota),
    profileLine("download/byte", template.pricePerDownloadByteIota),
    profileLine("retention/day", template.pricePerRetentionDayIota),
  ].filter(Boolean) as string[];

  return parts.length ? parts.join(" | ") : "-";
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
    const entries = Object.entries(themeStyle).filter((entry): entry is [string, string] => typeof entry[1] === "string");
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
      await refreshStatus();
    }

    void init();
    const timer = window.setInterval(() => void refreshStatus(), REFRESH_MS);
    return () => window.clearInterval(timer);
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
                <ConnectButton connectText="Connect Wallet" />
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
            <MetricCard label="Message events" value={status?.metrics.messageEvents ?? "-"} />
            <MetricCard
              label="Latest checkpoint"
              value={status?.latestCheckpoint ?? "-"}
              hint={loading ? "Refreshing..." : "On-chain"}
            />
          </section>

          <TaskRunner
            examples={examples}
            activeNetwork={activeNetwork}
            onExecuted={() => void refreshStatus()}
            onTemplateIdChange={setSelectedTemplateId}
          />

          <section className="card">
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
            <div className="table-wrap table-wrap-wide">
              <table className="responsive-table">
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Enabled</th>
                    <th>Base price</th>
                    <th>Price profile (USD)</th>
                    <th>Input bytes max</th>
                    <th>Output bytes max</th>
                    <th>Included download bytes</th>
                    <th>Price / download byte</th>
                    <th>Storage</th>
                    <th>Min retention days</th>
                    <th>Max retention days</th>
                    <th>Price / retention day</th>
                  </tr>
                </thead>
                <tbody>
                  {!status?.costs.templates?.length ? (
                    <tr>
                      <td colSpan={12} className="empty">
                        No task template costs found.
                      </td>
                    </tr>
                  ) : (
                    (status?.costs.templates ?? []).map((template) => {
                      const isSelected = selectedTemplateId === template.templateId;
                      return (
                        <tr
                          key={template.templateId}
                          style={isSelected ? { background: "rgba(34, 197, 94, 0.08)" } : undefined}
                        >
                          <td data-label="Template">
                            {template.taskType ? `${template.templateId} - ${template.taskType}` : template.templateId}
                          </td>
                          <td data-label="Enabled">{template.isEnabled ? "yes" : "no"}</td>
                          <td data-label="Base price">{template.basePriceIota ?? "-"}</td>
                          <td data-label="Price profile (USD)">{formatPriceProfile(template)}</td>
                          <td data-label="Input bytes max">{template.maxInputBytes ?? "-"}</td>
                          <td data-label="Output bytes max">{template.maxOutputBytes ?? "-"}</td>
                          <td data-label="Included download bytes">{template.includedDownloadBytes ?? "-"}</td>
                          <td data-label="Price / download byte">{template.pricePerDownloadByteIota ?? "-"}</td>
                          <td data-label="Storage">{template.allowStorage ? "yes" : "no"}</td>
                          <td data-label="Min retention days">{template.minRetentionDays ?? "-"}</td>
                          <td data-label="Max retention days">{template.maxRetentionDays ?? "-"}</td>
                          <td data-label="Price / retention day">{template.pricePerRetentionDayIota ?? "-"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <ActivityTable nodes={status?.nodeActivity ?? []} events={status?.recentEvents ?? []} />
        </>
      ) : (
        <ValidateTaskPage />
      )}
    </div>
  );
}
