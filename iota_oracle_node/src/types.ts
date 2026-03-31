export type QuorumSpec =
  | { type: "pct"; value: number }
  | { type: "n"; value: number };

export type ConsensusSpec =
  | { mode: "exact_hash"; quorum: QuorumSpec };

export type NormalizationSpec =
  | { kind: "text"; trim?: boolean; collapseWhitespace?: boolean; lineEnding?: "lf" | "crlf" }
  | { kind: "json"; dropKeys?: string[]; dropNulls?: boolean; sortArrays?: boolean }
  | {
      kind: "html";
      removeScripts?: boolean;
      removeStyles?: boolean;
      stripComments?: boolean;
      collapseWhitespace?: boolean;
      dropPatterns?: string[];
    };

export type JobOnchain = {
  jobId: string;
  type: string;
  request: { method: "GET"; url: string; headers?: Record<string, string> };
  normalization: NormalizationSpec;
  consensus?: ConsensusSpec;
  timeouts?: { step1Ms?: number };
};

export type NodeKeyInfo = {
  nodeId: string;
  secretKey: string; // bech32 secret key
  publicKeyBase64: string;
  address: string;
  createdAt: string;
};
