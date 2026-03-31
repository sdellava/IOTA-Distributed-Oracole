import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton, useCurrentAccount } from "@iota/dapp-kit";
import Menu, { Item as RcMenuItem, Divider } from "rc-menu";
import ActivityTable from "./components/ActivityTable";
import MetricCard from "./components/MetricCard";
import TaskRunner from "./components/TaskRunner";
import { fetchExamples, fetchStatus } from "./lib/api";
import type { ExampleTask, OracleStatus } from "./types";
import ValidateTaskPage from "./pages/ValidateTaskPage";

const REFRESH_MS = 10_000;

type PageMode = "run" | "validate";

function shortAddress(address: string, start = 6, end = 4): string {
  if (!address) return "-";
  if (address.length <= start + end + 3) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
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
  const menuRef = useRef<HTMLDivElement | null>(null);

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
    void refreshStatus();
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
  const networkLabel = useMemo(() => {
    const raw = status?.network || import.meta.env.VITE_IOTA_NETWORK || import.meta.env.VITE_NETWORK || "unknown";
    return String(raw).toUpperCase();
  }, [status?.network]);

  return (
    <div className="page">
      <header className="hero card">
        <div className="hero-top">
          <div className="hero-main">
            <h1>IOTA distributed oracle</h1>
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
                <span className="network-pill" title="IOTA network">
                  {networkLabel}
                </span>
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
                  {!selectedTemplateId ? (
                    <tr>
                      <td colSpan={11} className="empty">
                        Select a task example to view its template costs.
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const selectedTemplate = (status?.costs.templates ?? []).find(
                        (template) => template.templateId === selectedTemplateId,
                      );
                      if (!selectedTemplate) {
                        return (
                          <tr>
                            <td colSpan={11} className="empty">
                              No task template costs found for the selected task.
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={selectedTemplate.templateId}>
                          <td data-label="Template">
                            {selectedTemplate.taskType
                              ? `${selectedTemplate.templateId} - ${selectedTemplate.taskType}`
                              : selectedTemplate.templateId}
                          </td>
                          <td data-label="Enabled">{selectedTemplate.isEnabled ? "yes" : "no"}</td>
                          <td data-label="Base price">{selectedTemplate.basePriceIota ?? "-"}</td>
                          <td data-label="Input bytes max">{selectedTemplate.maxInputBytes ?? "-"}</td>
                          <td data-label="Output bytes max">{selectedTemplate.maxOutputBytes ?? "-"}</td>
                          <td data-label="Included download bytes">{selectedTemplate.includedDownloadBytes ?? "-"}</td>
                          <td data-label="Price / download byte">{selectedTemplate.pricePerDownloadByteIota ?? "-"}</td>
                          <td data-label="Storage">{selectedTemplate.allowStorage ? "yes" : "no"}</td>
                          <td data-label="Min retention days">{selectedTemplate.minRetentionDays ?? "-"}</td>
                          <td data-label="Max retention days">{selectedTemplate.maxRetentionDays ?? "-"}</td>
                          <td data-label="Price / retention day">{selectedTemplate.pricePerRetentionDayIota ?? "-"}</td>
                        </tr>
                      );
                    })()
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
