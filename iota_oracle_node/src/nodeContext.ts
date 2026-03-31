import type { IotaClient } from "@iota/iota-sdk/client";

import type { NodeIdentity } from "./keys";
import type { TaskCache } from "./cache/taskCache";

export type NodeContext = {
  client: IotaClient;
  identity: NodeIdentity;
  nodeId: string;
  myAddr: string;
  acceptedTemplateIds: number[];
  pollMs: number;
  startupMs: number;
  taskAssignedType: string;
  dataReqType: string;
  mediationType: string;
  msgType: string;
  cache: TaskCache;
};
