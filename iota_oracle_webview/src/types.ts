export type OracleNetwork = "mainnet" | "testnet" | "devnet";

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
};

export type RegisteredOracleNode = {
  address: string;
  pubkey: unknown;
  pubkeyBytes: number;
  acceptedTemplateIds: string[];
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

export type OracleStatus = {
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

export type ExampleTask = {
  name: string;
  path: string;
};

export type ExecuteTaskResponse = {
  ok: boolean;
  cwd: string;
  command: string;
  taskFilePath: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
};

export type PreparedWalletTaskResponse = {
  ok: true;
  mode: "prepare-webview";
  sender: string;
  variant: string;
  serializedTransaction: string;
  gasBudget: string;
  requiredPayment: string;
  rawPrice: string;
  systemFee: string;
  totalPrice: string;
  downloadPrice: string;
  extraDownloadBytes: string;
  balance: string;
  treasuryBalanceBefore: string | null;
  template: {
    templateId: number;
    taskType: string;
  };
  prepared: {
    templateId: number;
    taskType: string;
    requestedNodes: number;
    quorumK: number;
    retentionDays: number;
    declaredDownloadBytes: string;
    mediationMode: number;
    varianceMax: number;
    storageSourceUrl?: string;
    payloadJson: unknown;
  };
  cwd: string;
  command: string;
  taskFilePath: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
};

export type IotaMarketPriceResponse = {
  symbol: "IOTA";
  quoteCurrency: "USD";
  usdPrice: number;
  sourceName: "CoinMarketCap";
  sourceUrl: string;
  fetchedAtIso: string;
  cacheTtlMs: number;
};

export type NetworkConfigResponse = {
  activeNetwork: OracleNetwork;
  supportedNetworks: OracleNetwork[];
  rpcUrl: string;
  tasksPackageId: string | null;
  systemPackageId: string | null;
  stateId: string | null;
};
