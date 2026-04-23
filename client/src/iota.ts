import 'dotenv/config';
import { IotaClient, getFullnodeUrl } from '@iota/iota-sdk/client';

export function iotaClient(): IotaClient {
  const network = (process.env.IOTA_NETWORK?.trim() || 'devnet') as 'devnet' | 'testnet' | 'mainnet' | 'localnet';
  const url = process.env.IOTA_RPC_URL?.trim() || getFullnodeUrl(network === 'localnet' ? 'devnet' : network);
  return new IotaClient({ url });
}
