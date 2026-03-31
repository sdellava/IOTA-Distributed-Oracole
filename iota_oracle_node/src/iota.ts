import 'dotenv/config';
import { IotaClient } from '@iota/iota-sdk/client';

export function iotaClient(): IotaClient {
  const url = process.env.IOTA_RPC_URL?.trim();
  if (!url) throw new Error('Missing env IOTA_RPC_URL');
  return new IotaClient({ url });
}
