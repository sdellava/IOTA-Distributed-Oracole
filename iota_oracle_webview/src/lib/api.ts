import type {
  ExampleTask,
  ExecuteTaskResponse,
  NetworkConfigResponse,
  OracleNetwork,
  OracleStatus,
  PreparedWalletTaskResponse,
} from '../types';

async function ensureOk<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchStatus(): Promise<OracleStatus> {
  return ensureOk<OracleStatus>(await fetch('/api/status'));
}

export async function fetchNetworkConfig(): Promise<NetworkConfigResponse> {
  return ensureOk<NetworkConfigResponse>(await fetch('/api/network'));
}

export async function updateActiveNetwork(network: OracleNetwork): Promise<NetworkConfigResponse> {
  return ensureOk<NetworkConfigResponse>(
    await fetch('/api/network', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ network }),
    }),
  );
}

export async function fetchExamples(): Promise<ExampleTask[]> {
  return ensureOk<ExampleTask[]>(await fetch('/api/examples'));
}

export async function fetchExampleContent(name: string): Promise<unknown> {
  return ensureOk<unknown>(await fetch(`/api/examples/${encodeURIComponent(name)}`));
}

export async function executeTask(task: unknown): Promise<ExecuteTaskResponse> {
  return ensureOk<ExecuteTaskResponse>(
    await fetch('/api/tasks/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ task }),
    }),
  );
}

export async function prepareWalletTask(task: unknown, sender: string): Promise<PreparedWalletTaskResponse> {
  return ensureOk<PreparedWalletTaskResponse>(
    await fetch('/api/tasks/prepare-wallet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ task, sender }),
    }),
  );
}
