import type { NodeActivity, OracleEventItem, OracleNetwork } from '../types';

type Props = {
  nodes: NodeActivity[];
  events: OracleEventItem[];
  activeNetwork: OracleNetwork;
};

function formatTs(value: string | null): string {
  if (!value) return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Date(n).toLocaleString();
}

function formatValidatorLabel(name?: string | null, id?: string | null): string {
  if (name) return name;
  if (!id) return '-';
  if (id.length <= 18) return id;
  return `${id.slice(0, 10)}...${id.slice(-8)}`;
}

function getValidatorExplorerUrl(validatorId: string, activeNetwork: OracleNetwork): string {
  const url = new URL(`https://explorer.iota.org/validator/${encodeURIComponent(validatorId)}`);
  if (activeNetwork !== 'mainnet') {
    url.searchParams.set('network', activeNetwork);
  }
  return url.toString();
}

function getTransactionExplorerUrl(digest: string, activeNetwork: OracleNetwork): string {
  const url = new URL(`https://explorer.iota.org/txblock/${encodeURIComponent(digest)}`);
  if (activeNetwork !== 'mainnet') {
    url.searchParams.set('network', activeNetwork);
  }
  return url.toString();
}

export default function ActivityTable({ nodes, events, activeNetwork }: Props) {
  return (
    <div className="grid two-col">
      <section className="card">
        <div className="section-title">Node activity</div>
        <div className="table-wrap">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Node address</th>
                <th>Accepted tasks</th>
                <th>Last seen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {nodes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty">No node activity found.</td>
                </tr>
              ) : (
                nodes.map((node) => (
                  <tr key={node.sender}>
                    <td data-label="Node address">
                      <div className="mono">{node.sender}</div>
                      <div>
                        Delegated by:{' '}
                        {node.validatorId ? (
                          <a
                            className="digest-link"
                            href={getValidatorExplorerUrl(node.validatorId, activeNetwork)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {formatValidatorLabel(node.validatorName, node.validatorId)}
                          </a>
                        ) : (
                          formatValidatorLabel(node.validatorName, node.validatorId)
                        )}
                      </div>
                    </td>
                    <td data-label="Accepted tasks">
                      {node.acceptedTasks.length > 0 ? node.acceptedTasks.join(", ") : "-"}
                    </td>
                    <td data-label="Last seen">{formatTs(node.lastSeenMs)}</td>
                    <td data-label="Status">
                      <span className={node.active ? 'badge badge-ok' : 'badge badge-muted'}>
                        {node.active ? 'active' : 'inactive'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-title">Recent oracle events</div>
        <div className="table-wrap">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Module</th>
                <th>Sender</th>
                <th>Type</th>
                <th>Digest</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">No recent events found.</td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={`${event.txDigest}-${event.eventSeq}`}>
                    <td data-label="Time">{formatTs(event.timestampMs)}</td>
                    <td data-label="Module">{event.module}</td>
                    <td className="mono" data-label="Sender">{event.sender}</td>
                    <td className="mono" data-label="Type">{event.eventType}</td>
                    <td className="mono" data-label="Digest">
                      {event.txDigest ? (
                        <a
                          className="digest-link"
                          href={getTransactionExplorerUrl(event.txDigest, activeNetwork)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {event.txDigest}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
