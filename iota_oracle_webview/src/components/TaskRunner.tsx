import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction } from '@iota/dapp-kit';
import { IotaClient, type ChainType } from '@iota/iota-sdk/client';
import { Transaction } from '@iota/iota-sdk/transactions';
import { fetchExampleContent, prepareWalletTask } from '../lib/api';
import { resolveApiBaseUrl } from '../lib/apiBase';
import type { ExampleTask, OracleNetwork, PreparedWalletTaskResponse, RegisteredOracleNode } from '../types';

type Props = {
  examples: ExampleTask[];
  activeNetwork: OracleNetwork;
  registeredNodes: RegisteredOracleNode[];
  onExecuted: () => void;
  onTemplateIdChange?: (templateId: string) => void;
};

type TaskStatusKind = 'submitted' | 'pending' | 'finalized' | 'no_consensus' | 'failed' | 'error';

type NoCommitMessage = {
  sender: string;
  round: number;
  reasonCode: number;
  message: string;
  txDigest: string;
  timestampMs: string | null;
};

type TaskLiveState = {
  kind: TaskStatusKind;
  state: number | null;
  phaseLabel: string;
  detail: string;
  round: number;
  mediationAttempts: number;
  mediationStatus: number;
  mediationVariance: number;
  resultText: string | null;
  noCommitMessages: NoCommitMessage[];
  updatedAt: string;
};

type WalletRunResult = {
  prepared: PreparedWalletTaskResponse;
  digest: string;
  taskId: string;
  live: TaskLiveState;
};

type TaskDetail = {
  assigned_nodes?: Array<string | number>;
  certificate_signers?: Array<string | number>;
};

type StageTone = 'neutral' | 'success' | 'danger';

type ProtocolStage = {
  key: string;
  label: string;
  tone?: StageTone;
  active: boolean;
  completed: boolean;
};


type TaskCompositeState = {
  taskFields: Record<string, any>;
  configFields: Record<string, any>;
  runtimeFields: Record<string, any>;
  taskType: string;
};

const POLL_MS = 1500;
const MAX_POLL_MS = 180_000;
const MEDIATION_MEAN_U64 = 1;

const MSG_NO_COMMIT = 7;
const NO_COMMIT_FETCH_LIMIT = 200;
const API_BASE = resolveApiBaseUrl();
const MAINNET_RPC_URL = import.meta.env.VITE_IOTA_MAINNET_RPC_URL?.trim() || 'https://api.mainnet.iota.cafe';
const TESTNET_RPC_URL = import.meta.env.VITE_IOTA_TESTNET_RPC_URL?.trim() || 'https://api.testnet.iota.cafe';
const DEVNET_RPC_URL =
  import.meta.env.VITE_IOTA_DEVNET_RPC_URL?.trim() ||
  import.meta.env.VITE_IOTA_RPC_URL?.trim() ||
  'https://api.devnet.iota.cafe';

const CHAIN_BY_NETWORK: Record<OracleNetwork, ChainType> = {
  mainnet: 'iota:mainnet',
  testnet: 'iota:testnet',
  devnet: 'iota:devnet',
};

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;
}

function extractFields(value: unknown): Record<string, any> | null {
  const record = asRecord(value);
  if (!record) return null;

  const fields = asRecord(record.fields);
  if (fields) return fields;

  const data = asRecord(record.data);
  if (data) {
    const nested = extractFields(data);
    if (nested) return nested;
  }

  const content = asRecord(record.content);
  if (content) {
    const nested = extractFields(content);
    if (nested) return nested;
  }

  return null;
}

function getMoveFields(value: unknown): Record<string, any> {
  return extractFields(value) ?? {};
}

function moveObjectIdToString(value: any): string {
  if (typeof value === 'string') return value.trim();
  const record = asRecord(value);
  if (!record) return '';
  for (const key of ['id', 'objectId', 'bytes']) {
    if (typeof record[key] === 'string') return String(record[key]).trim();
  }
  if (typeof record.value === 'string') return record.value.trim();
  return '';
}

function decodeVecU8(value: any): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'number')) return Uint8Array.from(value);

  const record = asRecord(value);
  if (!record) return new Uint8Array();

  if (Array.isArray(record.bytes) && record.bytes.every((item) => typeof item === 'number')) {
    return Uint8Array.from(record.bytes as number[]);
  }

  if (Array.isArray(record.value) && record.value.every((item) => typeof item === 'number')) {
    return Uint8Array.from(record.value as number[]);
  }

  const fields = extractFields(record);
  if (fields) {
    return decodeVecU8(fields.bytes ?? fields.value ?? fields.data ?? []);
  }

  return new Uint8Array();
}

function bytesToPrettyText(bytes: Uint8Array): string | null {
  if (!bytes.length) return null;
  try {
    const text = new TextDecoder().decode(bytes).trim();
    if (!text) return null;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  } catch {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

function shortAddress(address: string, start = 10, end = 8): string {
  if (!address) return '-';
  if (address.length <= start + end + 3) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

function formatValidatorLabel(name?: string | null, id?: string | null): string | null {
  if (name) return name;
  if (!id) return null;
  return shortAddress(id, 10, 8);
}

function extractArrayLike(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function extractTaskId(execution: any): string {
  const objectChanges = extractArrayLike(execution?.objectChanges ?? execution?.object_changes);
  const createdTask = objectChanges.find(
    (item: any) =>
      item?.type === 'created' &&
      String(item?.objectType ?? item?.object_type ?? '').includes('::oracle_tasks::Task') &&
      !String(item?.objectType ?? item?.object_type ?? '').includes('TaskOwnerCap'),
  );
  const byObjectChange = String(createdTask?.objectId ?? createdTask?.object_id ?? '').trim();
  if (byObjectChange) return byObjectChange;

  const events = extractArrayLike(execution?.events);
  const createdEvent = events.find((item: any) => {
    const type = String(item?.type ?? '');
    return type.endsWith('::oracle_tasks::TaskCreated') || type.endsWith('::oracle_tasks::TaskLifecycleEvent');
  });

  const parsed = asRecord(createdEvent?.parsedJson) ?? asRecord(createdEvent?.parsed_json) ?? {};
  const byEvent = moveObjectIdToString(parsed.task_id ?? parsed.taskId);
  return byEvent;
}

async function fetchExecutionForDigest(iotaClient: any, digest: string, fallbackExecution: any): Promise<any> {
  const options = {
    showRawEffects: true,
    showEffects: true,
    showObjectChanges: true,
    showEvents: true,
  };

  if (!digest) return fallbackExecution;

  if (typeof iotaClient?.waitForTransaction === 'function') {
    try {
      return await iotaClient.waitForTransaction({ digest, options });
    } catch {
      // fall through
    }
  }

  if (typeof iotaClient?.getTransactionBlock === 'function') {
    try {
      return await iotaClient.getTransactionBlock({ digest, options });
    } catch {
      // fall through
    }
  }

  return fallbackExecution;
}

function extractPackageIdFromMoveType(typeName: string): string {
  const value = String(typeName ?? '').trim();
  if (!value) return '';
  const idx = value.indexOf('::');
  if (idx <= 0) return '';
  return value.slice(0, idx);
}

function normalizeAddress(address: string): string {
  const value = String(address ?? '').trim().toLowerCase();
  if (!value) return '';
  return value.startsWith('0x') ? value : `0x${value}`;
}

function extractNoCommitMessage(parsedJson: any, event: any): NoCommitMessage | null {
  const parsed = asRecord(parsedJson);
  if (!parsed) return null;

  const taskId = moveObjectIdToString(parsed.task_id ?? parsed.taskId);
  if (!taskId) return null;

  const kind = Number(parsed.kind ?? -1);
  if (kind !== MSG_NO_COMMIT) return null;

  return {
    sender: normalizeAddress(String(parsed.sender ?? event?.sender ?? '')),
    round: Number(parsed.round ?? 0),
    reasonCode: Number(parsed.value0 ?? 0),
    message: bytesToPrettyText(decodeVecU8(parsed.payload)) ?? '',
    txDigest: String(event?.id?.txDigest ?? ''),
    timestampMs: typeof event?.timestampMs === 'string' ? event.timestampMs : null,
  };
}

async function readNoCommitMessages(iotaClient: any, taskId: string, taskType: string): Promise<NoCommitMessage[]> {
  const packageId = extractPackageIdFromMoveType(taskType);
  if (!packageId || typeof iotaClient?.queryEvents !== 'function') return [];

  const page = await iotaClient.queryEvents({
    query: {
      MoveModule: {
        package: packageId,
        module: 'oracle_messages',
      },
    },
    limit: NO_COMMIT_FETCH_LIMIT,
  });

  const normalizedTaskId = normalizeAddress(taskId);
  const items = extractArrayLike(page?.data)
    .map((event: any) => {
      const item = extractNoCommitMessage(event?.parsedJson ?? event?.parsed_json, event);
      if (!item) return null;
      const eventTaskId = moveObjectIdToString((event?.parsedJson ?? event?.parsed_json)?.task_id ?? (event?.parsedJson ?? event?.parsed_json)?.taskId);
      if (normalizeAddress(eventTaskId) !== normalizedTaskId) return null;
      return item;
    })
    .filter(Boolean) as NoCommitMessage[];

  items.sort((a, b) => {
    const ta = Number(a.timestampMs ?? 0);
    const tb = Number(b.timestampMs ?? 0);
    return tb - ta;
  });

  return items;
}

function normalizeTaskText(value: string): { task: unknown; normalizedText: string } {
  const task = JSON.parse(value);
  return {
    task,
    normalizedText: JSON.stringify(task),
  };
}

async function readTaskCompositeState(iotaClient: any, taskId: string): Promise<TaskCompositeState> {
  const taskObj = await iotaClient.getObject({ id: taskId, options: { showContent: true, showType: true } });
  const taskFields = getMoveFields(taskObj);
  const configId = moveObjectIdToString(taskFields.config_id);
  const runtimeId = moveObjectIdToString(taskFields.runtime_id);

  const [configObj, runtimeObj] = await Promise.all([
    configId ? iotaClient.getObject({ id: configId, options: { showContent: true, showType: true } }) : null,
    runtimeId ? iotaClient.getObject({ id: runtimeId, options: { showContent: true, showType: true } }) : null,
  ]);

  return {
    taskFields,
    configFields: configObj ? getMoveFields(configObj) : {},
    runtimeFields: runtimeObj ? getMoveFields(runtimeObj) : {},
    taskType: String(taskObj?.data?.type ?? ''),
  };
}

function phaseLabelForState(state: number): string {
  switch (state) {
    case 1:
      return 'Commit phase';
    case 2:
      return 'Reveal phase';
    case 3:
      return 'Collecting raw data';
    case 4:
      return 'No consensus';
    case 9:
      return 'Completed';
    case 10:
      return 'Failed';
    default:
      return 'Pending';
  }
}

function describeSnapshot(snapshot: TaskCompositeState): TaskLiveState {
  const task = snapshot.taskFields;
  const config = snapshot.configFields;
  const runtime = snapshot.runtimeFields;

  const state = Number(task.state ?? -1);
  const round = Number(task.active_round ?? 0);
  const mediationMode = Number(task.mediation_mode ?? config.mediation_mode ?? runtime.mediation_mode ?? 0);
  const mediationAttempts = Number(task.mediation_attempts ?? runtime.mediation_attempts ?? 0);
  const mediationStatus = Number(task.mediation_status ?? runtime.mediation_status ?? 0);
  const mediationVariance = Number(task.mediation_variance ?? runtime.mediation_variance ?? 0);
  const resultText = bytesToPrettyText(decodeVecU8(task.result));
  const mediationEnabled = mediationMode === MEDIATION_MEAN_U64;

  if (resultText || state === 9) {
    return {
      kind: 'finalized',
      state,
      phaseLabel: 'Completed',
      detail: resultText ? 'Result received from oracle network.' : 'Task finalized on-chain.',
      round,
      mediationAttempts,
      mediationStatus,
      mediationVariance,
      resultText,
      noCommitMessages: [],
      updatedAt: new Date().toISOString(),
    };
  }

  if (state === 10) {
    if (mediationEnabled && (mediationStatus === 2 || mediationAttempts > 0)) {
      return {
        kind: 'no_consensus',
        state,
        phaseLabel: 'No consensus',
        detail:
          mediationStatus === 2
            ? `Mediation blocked. Observed variance: ${mediationVariance}.`
            : 'Mediation was attempted but the task did not converge.',
        round,
        mediationAttempts,
        mediationStatus,
        mediationVariance,
        resultText: null,
        noCommitMessages: [],
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      kind: 'failed',
      state,
      phaseLabel: 'Failed',
      detail: 'The task ended in a failed state on-chain.',
      round,
      mediationAttempts,
      mediationStatus,
      mediationVariance,
      resultText: null,
      noCommitMessages: [],
      updatedAt: new Date().toISOString(),
    };
  }

  if (state === 4) {
    if (!mediationEnabled || mediationStatus === 2 || mediationAttempts > 0) {
      return {
        kind: 'no_consensus',
        state,
        phaseLabel: 'No consensus',
        detail:
          mediationStatus === 2
            ? `Consensus not reached and mediation blocked. Variance: ${mediationVariance}.`
            : 'Consensus not reached.',
        round,
        mediationAttempts,
        mediationStatus,
        mediationVariance,
        resultText: null,
        noCommitMessages: [],
        updatedAt: new Date().toISOString(),
      };
    }
  }

  return {
    kind: state >= 0 ? 'pending' : 'submitted',
    state,
    phaseLabel: phaseLabelForState(state),
    detail: state === 4 ? 'Waiting for mediation round.' : 'Waiting for oracle nodes to complete the task.',
    round,
    mediationAttempts,
    mediationStatus,
    mediationVariance,
    resultText: null,
    noCommitMessages: [],
    updatedAt: new Date().toISOString(),
  };
}


function buildProtocolStages(live: TaskLiveState): ProtocolStage[] {
  const terminalFail = live.kind === 'failed' || live.kind === 'error' || live.kind === 'no_consensus';
  const finalized = live.kind === 'finalized';
  const state = live.state ?? null;
  const mediationStarted = live.round > 0 || live.mediationAttempts > 0 || live.mediationStatus === 1;
  const mediationRunning = mediationStarted && !finalized && !terminalFail;

  let currentKey = 'submitted';
  if (finalized) {
    currentKey = 'finalize';
  } else if (terminalFail) {
    currentKey = 'fail';
  } else if (mediationRunning) {
    currentKey = 'mediation';
  } else if (state === 2) {
    currentKey = 'reveal';
  } else if (state === 1 || live.kind === 'pending') {
    currentKey = 'commit';
  }

  const stages: ProtocolStage[] = [
    { key: 'submitted', label: 'Submitted', tone: 'neutral', active: currentKey === 'submitted', completed: currentKey !== 'submitted' },
    { key: 'commit', label: 'Commit', tone: 'neutral', active: currentKey === 'commit', completed: ['reveal', 'mediation', 'finalize', 'fail'].includes(currentKey) },
    { key: 'reveal', label: 'Reveal', tone: 'neutral', active: currentKey === 'reveal', completed: ['mediation', 'finalize', 'fail'].includes(currentKey) },
    { key: 'mediation', label: 'Mediation', tone: 'neutral', active: currentKey === 'mediation', completed: mediationStarted && (finalized || currentKey === 'fail') },
    { key: 'finalize', label: 'Finalize', tone: 'success', active: currentKey === 'finalize', completed: finalized },
    { key: 'fail', label: 'Fail', tone: 'danger', active: currentKey === 'fail', completed: terminalFail },
  ];

  return stages;
}

function statusBadgeClass(kind: TaskStatusKind): string {
  if (kind === 'finalized') return 'badge-ok';
  if (kind === 'failed' || kind === 'error') return 'badge-err';
  if (kind === 'no_consensus') return 'badge-warn';
  return 'badge-muted';
}

export default function TaskRunner({ examples, activeNetwork, registeredNodes, onExecuted, onTemplateIdChange }: Props) {
  const [taskText, setTaskText] = useState<string>('{}');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WalletRunResult | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedExample, setSelectedExample] = useState<string>('');
  const currentAccount = useCurrentAccount();
  const iotaClients = useMemo(
    () => ({
      mainnet: new IotaClient({ url: MAINNET_RPC_URL }),
      testnet: new IotaClient({ url: TESTNET_RPC_URL }),
      devnet: new IotaClient({ url: DEVNET_RPC_URL }),
    }),
    [],
  );
  const nodeMetaByAddress = useMemo(
    () =>
      new Map(
        registeredNodes
          .map((node) => [
            normalizeAddress(node.address),
            {
              validatorLabel: formatValidatorLabel(node.validatorName, node.validatorId),
              validatorId: node.validatorId ?? null,
            },
          ] as const)
          .filter(([address]) => Boolean(address)),
      ),
    [registeredNodes],
  );
  const executionClientRef = useRef(iotaClients.devnet);
  const pollTokenRef = useRef(0);
  const { mutateAsync: signAndExecuteTransaction } = useSignAndExecuteTransaction({
    execute: async ({ bytes, signature }) =>
      await executionClientRef.current.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: {
          showRawEffects: true,
          showEffects: true,
          showObjectChanges: true,
          showEvents: true,
        },
      }),
  });

  useEffect(() => {
    return () => {
      pollTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const taskId = result?.taskId?.trim();
    if (!taskId) {
      setTaskDetail(null);
      return;
    }

    let cancelled = false;
    const loadTaskDetail = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/task/${encodeURIComponent(taskId)}`);
        if (!response.ok) {
          throw new Error(`Unable to load task detail: HTTP ${response.status}`);
        }
        const payload = (await response.json()) as TaskDetail;
        if (!cancelled) {
          setTaskDetail(payload);
        }
      } catch {
        if (!cancelled) {
          setTaskDetail(null);
        }
      }
    };

    void loadTaskDetail();
    return () => {
      cancelled = true;
    };
  }, [result?.taskId, result?.live.updatedAt]);

  const assignedNodeRows = useMemo(() => {
    const assignedNodes = Array.isArray(taskDetail?.assigned_nodes)
      ? taskDetail.assigned_nodes.map((item) => normalizeAddress(String(item))).filter(Boolean)
      : [];
    const certificateSigners = new Set(
      Array.isArray(taskDetail?.certificate_signers)
        ? taskDetail.certificate_signers.map((item) => normalizeAddress(String(item))).filter(Boolean)
        : [],
    );

    return assignedNodes.map((address) => {
      const nodeMeta = nodeMetaByAddress.get(address);
      return {
        address,
        signed: certificateSigners.has(address),
        validatorLabel: nodeMeta?.validatorLabel ?? null,
        validatorId: nodeMeta?.validatorId ?? null,
      };
    });
  }, [nodeMetaByAddress, taskDetail]);

  const parsedTask = useMemo(() => {
    try {
      return JSON.parse(taskText);
    } catch {
      return null;
    }
  }, [taskText]);

  useEffect(() => {
    const templateId = parsedTask && typeof parsedTask === 'object' && !Array.isArray(parsedTask)
      ? (parsedTask as Record<string, unknown>).template_id
      : null;

    if (typeof templateId === 'number' || typeof templateId === 'string') {
      onTemplateIdChange?.(String(templateId));
      return;
    }

    onTemplateIdChange?.('');
  }, [parsedTask, onTemplateIdChange]);

  async function onLoadExample(name: string) {
    setSelectedExample(name);
    if (!name) return;
    setError(null);
    try {
      const content = await fetchExampleContent(name);
      setTaskText(JSON.stringify(content, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onFileChange(file: File | null) {
    if (!file) return;
    setError(null);
    const text = await file.text();
    setTaskText(text);
  }

  async function monitorTask(
    networkClient: IotaClient,
    taskId: string,
    basePrepared: PreparedWalletTaskResponse,
    digest: string,
    token: number,
  ) {
    const startedAt = Date.now();

    while (pollTokenRef.current === token && Date.now() - startedAt < MAX_POLL_MS) {
      try {
        const snapshot = await readTaskCompositeState(networkClient, taskId);
        const baseLive = describeSnapshot(snapshot);
        const noCommitMessages = await readNoCommitMessages(networkClient, taskId, snapshot.taskType).catch(
          () => [] as NoCommitMessage[],
        );
        const latestNoCommit = noCommitMessages[0];
        const live: TaskLiveState = {
          ...baseLive,
          noCommitMessages,
          detail:
            baseLive.kind === 'failed' && latestNoCommit?.message
              ? `No commit received: ${latestNoCommit.message}`
              : baseLive.detail,
        };

        setResult({
          prepared: basePrepared,
          digest,
          taskId,
          live,
        });

        if (live.kind === 'finalized' || live.kind === 'no_consensus' || live.kind === 'failed') {
          onExecuted();
          return;
        }
      } catch (err) {
        setResult({
          prepared: basePrepared,
          digest,
          taskId,
          live: {
            kind: 'error',
            state: null,
            phaseLabel: 'Read error',
            detail: err instanceof Error ? err.message : String(err),
            round: 0,
            mediationAttempts: 0,
            mediationStatus: 0,
            mediationVariance: 0,
            resultText: null,
            noCommitMessages: [],
            updatedAt: new Date().toISOString(),
          },
        });
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
    }

    if (pollTokenRef.current === token) {
      setResult((prev) => {
        if (!prev || prev.taskId !== taskId) return prev;
        return {
          ...prev,
          live: {
            ...prev.live,
            kind: prev.live.kind === 'pending' ? 'error' : prev.live.kind,
            phaseLabel: prev.live.kind === 'pending' ? 'Timeout' : prev.live.phaseLabel,
            detail:
              prev.live.kind === 'pending'
                ? 'Timeout while waiting for a terminal task state. The task may still complete later on-chain.'
                : prev.live.detail,
            updatedAt: new Date().toISOString(),
          },
        };
      });
    }
  }

  async function onSubmit() {
    setError(null);
    setResult(null);
    setTaskDetail(null);

    if (!parsedTask) {
      setError('Task JSON is not valid.');
      return;
    }

    if (!currentAccount?.address) {
      setError('Connect an external wallet before submitting the task.');
      return;
    }

    setBusy(true);
    try {
      const { task, normalizedText } = normalizeTaskText(taskText);
      if (normalizedText !== taskText) {
        setTaskText(JSON.stringify(task, null, 2));
      }

      const networkClient = iotaClients[activeNetwork];
      const chain = CHAIN_BY_NETWORK[activeNetwork];
      executionClientRef.current = networkClient;

      const prepared = await prepareWalletTask(task, currentAccount.address, activeNetwork);
      const transaction = Transaction.from(prepared.serializedTransaction);
      const execution = await signAndExecuteTransaction({ transaction, chain });
      const digest = String(execution?.digest ?? '').trim();
      const confirmedExecution = await fetchExecutionForDigest(networkClient, digest, execution);
      const taskId = extractTaskId(confirmedExecution) || extractTaskId(execution);

      if (!taskId) {
        throw new Error(
          `Wallet execution succeeded, but the created task id could not be extracted from the transaction. digest=${digest || '<unknown>'}`,
        );
      }

      const token = pollTokenRef.current + 1;
      pollTokenRef.current = token;

      setResult({
        prepared,
        digest,
        taskId,
        live: {
          kind: 'submitted',
          state: null,
          phaseLabel: 'Submitted',
          detail: 'Transaction accepted. Waiting for the oracle network to process the task.',
          round: 0,
          mediationAttempts: 0,
          mediationStatus: 0,
          mediationVariance: 0,
          resultText: null,
          noCommitMessages: [],
          updatedAt: new Date().toISOString(),
        },
      });

      void monitorTask(networkClient, taskId, prepared, digest, token);
      onExecuted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card task-card">
      <div className="section-title">Run a task</div>
      <div className="task-intro">
        The server prepares the transaction, your wallet signs it, and the webview then follows the task on-chain until a terminal state.
      </div>

      <div className="task-toolbar task-toolbar-grid">
        <label>
          Example
          <select value={selectedExample} onChange={(e) => void onLoadExample(e.target.value)}>
            <option value="">Select...</option>
            {examples.map((example) => (
              <option key={example.path} value={example.name}>
                {example.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Upload JSON
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <div className="wallet-hint-row">
        <span className={`badge ${currentAccount ? 'badge-ok' : 'badge-muted'}`}>
          {currentAccount ? 'wallet connected' : 'wallet required'}
        </span>
        <span className="wallet-hint-text mono">{currentAccount?.address ?? 'Connect a wallet to sign the transaction.'}</span>
      </div>

      <textarea
        className="task-editor"
        value={taskText}
        onChange={(e) => setTaskText(e.target.value)}
        spellCheck={false}
      />

      <div className="task-actions task-actions-mobile">
        <button className="wallet-submit-button" onClick={() => void onSubmit()} disabled={busy || !parsedTask || !currentAccount}>
          {busy ? 'Opening wallet...' : 'Sign and execute with wallet'}
        </button>
        {!parsedTask ? <span className="error-inline">Invalid JSON</span> : null}
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {result ? (
        <div className="result-grid">
          <div className="task-summary-grid">
            <div className="task-summary-card">
              <div className="summary-label">Task</div>
              <div className="summary-value mono">{shortAddress(result.taskId, 14, 10)}</div>
              <div className="summary-hint mono full-value">{result.taskId}</div>
            </div>
            <div className="task-summary-card">
              <div className="summary-label">Tx digest</div>
              <div className="summary-value mono">{shortAddress(result.digest, 10, 8)}</div>
              <div className="summary-hint mono full-value">{result.digest || '-'}</div>
            </div>
            <div className="task-summary-card">
              <div className="summary-label">Template</div>
              <div className="summary-value">{result.prepared.template.templateId} - {result.prepared.template.taskType}</div>
              <div className="summary-hint">Sender: <span className="mono">{shortAddress(result.prepared.sender, 10, 8)}</span></div>
            </div>
          </div>

          <div className="task-status-panel">
            <div className="task-status-head">
              <div>
                <div className="subsection-title">Task status</div>
                <div className="task-status-detail">{result.live.detail}</div>
              </div>
            </div>

            <table className="task-status-table" role="presentation">
              <tbody>
                <tr>
                  <td className="task-status-table-cell task-status-table-metrics" style={{ verticalAlign: 'top' }}>
                      <dl className="result-list compact-result-list task-status-metrics">
                      <div>
                        <dt>On-chain state</dt>
                        <dd>{result.live.state == null ? '-' : String(result.live.state)}</dd>
                      </div>
                      <div>
                        <dt>Round</dt>
                        <dd>{String(result.live.round)}</dd>
                      </div>
                      <div>
                        <dt>Mediation</dt>
                        <dd>
                          attempts={result.live.mediationAttempts}, status={result.live.mediationStatus}, variance={result.live.mediationVariance}
                        </dd>
                      </div>
                      <div>
                        <dt>Updated</dt>
                        <dd>{new Date(result.live.updatedAt).toLocaleString()}</dd>
                      </div>
                    </dl>
                  </td>
                  <td className="task-status-table-cell task-status-table-phases">
                    <div className="task-phase-stack" aria-label="Task protocol phases">
                      {buildProtocolStages(result.live).map((stage) => (
                        <span
                          key={stage.key}
                          className={`phase-chip ${stage.active ? 'phase-chip-active' : ''} ${stage.completed ? 'phase-chip-completed' : ''} ${stage.tone === 'success' ? 'phase-chip-success' : ''} ${stage.tone === 'danger' ? 'phase-chip-danger' : ''}`}
                        >
                          {stage.label}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {result.live.noCommitMessages.length ? (
            <div>
              <div className="subsection-title">No commit messages</div>
              <div className="table-wrap">
                <table className="responsive-table">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Round</th>
                      <th>Reason</th>
                      <th>Message</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.live.noCommitMessages.map((item, index) => (
                      <tr key={`${item.txDigest || item.sender}-${index}`}>
                        <td data-label="Node">
                          {(() => {
                            const nodeMeta = nodeMetaByAddress.get(normalizeAddress(item.sender));
                            return (
                              <>
                                <div className="mono" title={item.sender || undefined}>
                                  {shortAddress(item.sender, 10, 8)}
                                </div>
                                <div className="mono full-value" title={item.sender || undefined}>
                                  oracle: {item.sender || '-'}
                                </div>
                                {nodeMeta?.validatorLabel ? (
                                  <div title={nodeMeta.validatorId || undefined}>validator: {nodeMeta.validatorLabel}</div>
                                ) : null}
                              </>
                            );
                          })()}
                        </td>
                        <td data-label="Round">{item.round}</td>
                        <td data-label="Reason">{item.reasonCode || '-'}</td>
                        <td data-label="Message">{item.message || '-'}</td>
                        <td data-label="Updated">{item.timestampMs ? new Date(Number(item.timestampMs)).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {assignedNodeRows.length ? (
            <div className="task-status-panel">
              <div className="subsection-title">Assigned nodes</div>
              <div className="table-wrap">
                <table className="responsive-table">
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Validator</th>
                      <th>Signed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignedNodeRows.map((item) => (
                      <tr key={item.address}>
                        <td data-label="Node">
                          <div className="mono" title={item.address}>
                            {shortAddress(item.address, 10, 8)}
                          </div>
                          <div className="summary-hint mono full-value">{item.address}</div>
                        </td>
                        <td data-label="Validator">
                          {item.validatorLabel ? (
                            <div title={item.validatorId || undefined}>{item.validatorLabel}</div>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td data-label="Signed">
                          <span className={`badge ${item.signed ? 'badge-ok' : 'badge-muted'}`}>
                            {item.signed ? 'signed' : 'assigned only'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {result.live.resultText ? (
            <div>
              <div className="subsection-title">Task result</div>
              <pre>{result.live.resultText}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
