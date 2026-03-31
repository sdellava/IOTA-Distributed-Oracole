import type { ReactNode } from 'react';

type Props = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
};

export default function MetricCard({ label, value, hint }: Props) {
  return (
    <div className="card metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}
