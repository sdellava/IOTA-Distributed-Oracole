import 'dotenv/config';
import { IotaClient, getFullnodeUrl } from '@iota/iota-sdk/client';

function normalizeNetwork(raw: string | undefined): 'devnet' | 'testnet' | 'mainnet' | 'localnet' {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'test' || value === 'testnet') return 'testnet';
  if (value === 'main' || value === 'mainnet') return 'mainnet';
  if (value === 'local' || value === 'localnet') return 'localnet';
  return 'devnet';
}

function networkRpcEnvKey(network: 'devnet' | 'testnet' | 'mainnet' | 'localnet'): string {
  if (network === 'testnet') return 'TESTNET_IOTA_RPC_URL';
  if (network === 'mainnet') return 'MAINNET_IOTA_RPC_URL';
  return 'DEVNET_IOTA_RPC_URL';
}

export function iotaClient(): IotaClient {
  const network = normalizeNetwork(process.env.IOTA_NETWORK);
  const url =
    process.env[networkRpcEnvKey(network)]?.trim() ||
    process.env.IOTA_RPC_URL?.trim() ||
    getFullnodeUrl(network === 'localnet' ? 'devnet' : network);
  return new IotaClient({ url });
}
