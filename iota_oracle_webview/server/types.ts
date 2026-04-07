export type OracleEventItem = {
  txDigest: string;
  eventSeq: string;
  sender: string;
  module: string;
  eventType: string;
  timestampMs: string | null;
  parsedJson: unknown;
};

export type NodeActivity = {
  sender: string;
  acceptedTasks: string[];
  lastSeenMs: string | null;
  active: boolean;
  validatorId?: string | null;
  validatorName?: string | null;
};

export type RegisteredOracleNode = {
  address: string;
  pubkey: unknown;
  pubkeyBytes: number;
  acceptedTemplateIds: string[];
  delegatedControllerCapId?: string | null;
  validatorId?: string | null;
  validatorName?: string | null;
};

export type OracleTemplateCost = {
  templateId: string;
  taskType: string;
  isEnabled: boolean;
  basePriceIota: string | null;
  maxInputBytes: string | null;
  maxOutputBytes: string | null;
  includedDownloadBytes: string | null;
  pricePerDownloadByteIota: string | null;
  allowStorage: boolean;
  minRetentionDays: string | null;
  maxRetentionDays: string | null;
  pricePerRetentionDayIota: string | null;
};

export type OracleStatusResponse = {
  ok: boolean;
  mode: "live" | "degraded";
  network: string;
  rpcUrl: string;
  packageId: string | null;
  tasksPackageId: string | null;
  systemPackageId: string | null;
  stateId: string | null;
  latestCheckpoint: string | null;
  activeWindowMinutes: number;
  eventFetchLimit: number;
  lastRefreshIso: string;
  metrics: {
    activeNodes: number;
    knownNodes: number | null;
    inactiveKnownNodes: number | null;
    taskEvents: number;
    messageEvents: number;
    totalEvents: number;
  };
  costs: {
    systemFeeBps: string | null;
    minPayment: string | null;
    templates: OracleTemplateCost[];
  };
  registeredNodes: RegisteredOracleNode[];
  nodeActivity: NodeActivity[];
  recentEvents: OracleEventItem[];
  warnings: string[];
};
