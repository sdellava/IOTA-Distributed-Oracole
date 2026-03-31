import type { IotaClient } from "@iota/iota-sdk/client";

import type { NodeIdentity } from "../keys";
import { optInt } from "../nodeConfig";
import {
  combineCommitAndFinalizeV2,
  publishCommitSignature,
  publishPartialSigV2,
  publishRevealHash,
  tryCloseCommitPhase,
  waitForWinningHash,
} from "../taskSignFlow";
import { waitForTaskState } from "./taskReader";

export async function runRound(opts: {
  client: IotaClient;
  identity: NodeIdentity;
  nodeId: string;
  taskId: string;
  round: number;
  taskType: string;
  payloadJson: any;
  normalizedText: string;
  assignedNodes: string[];
  quorumK: number;
  pubkeysByAddrB64: Map<string, string>;
}) {
  const { client, identity, nodeId, taskId, round, normalizedText, assignedNodes, quorumK, pubkeysByAddrB64 } = opts;

  const c = await publishCommitSignature({
    client,
    keypair: identity.keypair,
    taskId,
    round,
    normalizedText,
  });
  console.log(`[node ${nodeId}] commit published tx=${c.digest}`);

  let revealWait = await waitForTaskState({
    client,
    taskId,
    desiredState: 2,
    timeoutMs: optInt("WAIT_REVEAL_OPEN_MS", optInt("WAIT_REVEAL_MS", 90_000)),
    pollMs: optInt("WAIT_REVEAL_OPEN_POLL_MS", optInt("WAIT_REVEAL_POLL_MS", 1_500)),
  });

  if (!revealWait.ok && revealWait.state === 1) {
    try {
      const digest = await tryCloseCommitPhase({ client, keypair: identity.keypair, taskId });
      console.log(`[node ${nodeId}] close_commit_phase attempted tx=${digest}`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!/badphase|already finalized|state_/i.test(msg)) {
        console.warn(`[node ${nodeId}] close_commit_phase failed (ignored): ${msg}`);
      }
    }

    revealWait = await waitForTaskState({
      client,
      taskId,
      desiredState: 2,
      timeoutMs: optInt("WAIT_REVEAL_AFTER_CLOSE_MS", 8_000),
      pollMs: optInt("WAIT_REVEAL_AFTER_CLOSE_POLL_MS", 1_000),
    });
  }

  if (!revealWait.ok) {
    console.log(`[node ${nodeId}] reveal not open (state=${revealWait.state}) -> stop round=${round}`);
    return { ok: false as const, reason: "reveal_not_open" };
  }

  const r = await publishRevealHash({
    client,
    keypair: identity.keypair,
    taskId,
    round,
    resultHash: c.resultHash,
  });
  console.log(`[node ${nodeId}] reveal published tx=${r.digest}`);

  const win = await waitForWinningHash({
    client,
    taskId,
    round,
    assigned: assignedNodes,
    quorumK,
  });

  if (!win.ok) {
    console.log(`[node ${nodeId}] no winning hash: ${win.reason}`);
    return {
      ok: false as const,
      reason: win.reason,
      bestHashHex: (win as any).bestHashHex,
      bestCount: (win as any).bestCount,
    };
  }

  const localResultHashHex = Buffer.from(c.resultHash).toString("hex").toLowerCase();
  console.log(`[node ${nodeId}] winning hash=${win.hashHex} approvals=${win.count}/${quorumK}`);

  if (win.hashHex !== localResultHashHex) {
    console.log(`[node ${nodeId}] my hash != winning hash -> stop (my=${localResultHashHex})`);
    return { ok: false as const, reason: "not_winner" };
  }

  const ps = await publishPartialSigV2({
    client,
    keypair: identity.keypair,
    taskId,
    round,
    resultHash: c.resultHash,
  });
  console.log(`[node ${nodeId}] partial signature v2 published tx=${ps.digest}`);

  await combineCommitAndFinalizeV2({
    client,
    keypair: identity.keypair,
    taskId,
    round,
    normalizedText,
    assigned: assignedNodes,
    quorumK,
    pubkeysByAddrB64,
    winningHashHex: win.hashHex,
  });

  return { ok: true as const };
}
