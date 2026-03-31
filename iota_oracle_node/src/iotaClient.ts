import { getFullnodeUrl, IotaClient } from "@iota/iota-sdk/client";
import type { Network } from "./env.js";

export function makeClient(network: Network, rpcUrl?: string): IotaClient {
  const url = rpcUrl || getFullnodeUrl(network);
  return new IotaClient({ url });
}
