import 'dotenv/config';
import { IotaClient } from '@iota/iota-sdk/client';
import { envByNetwork } from './config/env';

export function iotaClient(): IotaClient {
  const url = envByNetwork("IOTA_RPC_URL");
  if (!url) throw new Error('Missing env IOTA_RPC_URL');
  return new IotaClient({ url });
}
