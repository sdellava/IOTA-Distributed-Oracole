// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import "dotenv/config";
import { Agent, setGlobalDispatcher } from "undici";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } as any }));
console.warn("[oracle-node] TLS certificate verification is DISABLED globally");

import { requestFaucetIfEnabled } from "./faucet";
import { iotaClient } from "./iota";
import { loadOrCreateNodeIdentity } from "./keys";
import { optBool, optInt, parseAcceptedTemplateIds } from "./nodeConfig";
import { registerOracleNode, unregisterOracleNode } from "./oracleTx";
import { TaskCache } from "./cache/taskCache";
import { defaultEventType, parseNodeId } from "./config/env";
import { NodeStats } from "./stats";
import {
  listenOracleMessages,
  listenTaskAssigned,
  listenTaskDataRequested,
  listenTaskMediationStarted,
} from "./events";
import { processAssigned, replayRecentAssignments } from "./handlers/assigned";
import { processDataRequested } from "./handlers/dataRequested";
import { processMediationStarted } from "./handlers/mediationStarted";
import { startMonitorServer, type MonitorRuntimeState } from "./monitor";
import type { NodeContext } from "./nodeContext";
import { startSchedulerWorker } from "./services/schedulerWorker";
import { sleep } from "./utils/sleep";

function buildContext(): NodeContext {
  const nodeId = parseNodeId(process.argv);
  const client = iotaClient();
  const identity = loadOrCreateNodeIdentity(nodeId);
  const myAddr = identity.address.toLowerCase();
  const acceptedTemplateIds = parseAcceptedTemplateIds();
  const pollMs = optInt("EVENT_POLL_MS", 1200);
  const startupMs = Date.now();

  return {
    client,
    identity,
    nodeId,
    myAddr,
    acceptedTemplateIds,
    pollMs,
    startupMs,
    taskAssignedType: defaultEventType("TASK_ASSIGNED_EVENT_TYPE", "oracle_tasks::TaskRunSubmitted"),
    dataReqType: defaultEventType("TASK_DATA_REQUESTED_EVENT_TYPE", "oracle_tasks::TaskLifecycleEvent"),
    mediationType: defaultEventType("TASK_MEDIATION_STARTED_EVENT_TYPE", "oracle_tasks::TaskRunMediationStarted"),
    msgType: defaultEventType("MESSAGE_EVENT_TYPE", "oracle_messages::OracleMessage"),
    cache: new TaskCache(),
    stats: new NodeStats(),
  };
}

async function registerNode(ctx: NodeContext): Promise<string | null> {
  try {
    const digest = await registerOracleNode({
      client: ctx.client,
      oracleKeypair: ctx.identity.keypair,
      oracleAddr: ctx.identity.address,
      oraclePubkeyRaw32: ctx.identity.publicKeyBytes,
    });
    if (digest) console.log(`[node ${ctx.nodeId}] registered tx=${digest}`);
    return digest ?? null;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.warn(`[node ${ctx.nodeId}] register failed (continue): ${msg}`);
    throw e;
  }
}

function registerRetryDelayMs(): number {
  return 1000 + Math.floor(Math.random() * 3001);
}

async function unregisterNode(ctx: NodeContext): Promise<void> {
  try {
    const digest = await unregisterOracleNode({ client: ctx.client, keypair: ctx.identity.keypair });
    if (digest) console.log(`[node ${ctx.nodeId}] unregistered tx=${digest}`);
  } catch (e: any) {
    console.warn(`[node ${ctx.nodeId}] unregister failed (ignored):`, e?.message ?? e);
  }
}

function installShutdownHooks(
  ctx: NodeContext,
  autoUnregister: boolean,
  wasRegistered: () => boolean,
): void {
  let shuttingDown = false;

  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[node ${ctx.nodeId}] shutdown (${reason})`);
    if (autoUnregister && wasRegistered()) await unregisterNode(ctx);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    console.error(`[node ${ctx.nodeId}] uncaughtException`, err);
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (err) => {
    console.error(`[node ${ctx.nodeId}] unhandledRejection`, err);
    void shutdown("unhandledRejection");
  });
}

function logStartup(ctx: NodeContext): void {
  console.log(`[node ${ctx.nodeId}] address=${ctx.identity.address}`);
  console.log(
    `[node ${ctx.nodeId}] accepted templates=${ctx.acceptedTemplateIds.length ? ctx.acceptedTemplateIds.join(",") : "<none>"}`,
  );
  console.log(`[node ${ctx.nodeId}] listening assigned tasks: ${ctx.taskAssignedType}`);
  console.log(`[node ${ctx.nodeId}] listening data requests: ${ctx.dataReqType}`);
  console.log(`[node ${ctx.nodeId}] listening mediation started: ${ctx.mediationType}`);
  console.log(`[node ${ctx.nodeId}] listening messages: ${ctx.msgType}`);
}

function startListeners(ctx: NodeContext): void {
  void listenTaskAssigned({
    client: ctx.client,
    nodeId: ctx.nodeId,
    myAddress: ctx.identity.address,
    moveEventType: ctx.taskAssignedType,
    pollMs: ctx.pollMs,
    minTimestampMs: ctx.startupMs,
    onAssigned: async ({ taskId, creator }) => {
      await processAssigned(ctx, taskId, creator);
    },
  });

  void listenTaskDataRequested({
    client: ctx.client,
    moveEventType: ctx.dataReqType,
    pollMs: ctx.pollMs,
    minTimestampMs: ctx.startupMs,
    onRequested: async ({ taskId, failedRound }) => {
      await processDataRequested(ctx, { taskId, failedRound });
    },
  });

  void listenTaskMediationStarted({
    client: ctx.client,
    moveEventType: ctx.mediationType,
    pollMs: ctx.pollMs,
    minTimestampMs: ctx.startupMs,
    onStarted: async ({ taskId, toRound }) => {
      await processMediationStarted(ctx, { taskId, toRound });
    },
  });

  if (ctx.msgType) {
    void listenOracleMessages({
      client: ctx.client,
      nodeId: ctx.nodeId,
      myAddress: ctx.identity.address,
      moveEventType: ctx.msgType,
      pollMs: ctx.pollMs,
      minTimestampMs: ctx.startupMs,
      onMessage: async ({ from, payload }) => {
        console.log(`[node ${ctx.nodeId}] msg from=${from} bytes=${payload.length}`);
      },
    });
  }
}

async function main() {
  const ctx = buildContext();
  const runtimeState: MonitorRuntimeState = {
    booting: true,
    listenersStarted: false,
    shutdownRequested: false,
    autoRegister: false,
    autoUnregister: false,
    registration: {
      attempted: false,
      succeeded: false,
      txDigest: null,
      lastError: null,
    },
  };
  logStartup(ctx);
  const monitorServer = startMonitorServer(ctx, runtimeState);

  await requestFaucetIfEnabled(ctx.identity.address);

  const autoUnregister = optBool("AUTO_UNREGISTER", true);
  const autoRegister = optBool("AUTO_REGISTER", true);
  runtimeState.autoRegister = autoRegister;
  runtimeState.autoUnregister = autoUnregister;

  installShutdownHooks(ctx, autoUnregister, () => runtimeState.registration.succeeded);

  if (autoRegister) {
    runtimeState.registration.attempted = true;
    for (;;) {
      try {
        runtimeState.registration.txDigest = await registerNode(ctx);
        runtimeState.registration.succeeded = true;
        runtimeState.registration.lastError = null;
        break;
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        runtimeState.registration.lastError = msg;
        const waitMs = registerRetryDelayMs();
        console.warn(`[node ${ctx.nodeId}] auto-register retry in ${waitMs} ms: ${msg}`);
        await sleep(waitMs);
      }
    }
  }

  startListeners(ctx);
  void replayRecentAssignments(ctx);
  startSchedulerWorker(ctx);
  runtimeState.listenersStarted = true;
  runtimeState.booting = false;

  monitorServer.on("close", () => {
    runtimeState.shutdownRequested = true;
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
