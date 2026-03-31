import { optInt, acceptsTemplate } from "../nodeConfig";
import { bytesToUtf8, decodeVecU8 } from "../events";
import { executeTask } from "../taskExec";
import { publishNoCommit } from "../taskSignFlow";
import type { NodeContext } from "../nodeContext";
import { buildMultiSigPublicKey } from "../multisig.js";
import { loadPubkeysByAddrB64 } from "../services/pubkeys";
import { loadTaskBundle, isTaskFreshForNode, taskCreatedAtMs } from "../services/taskObjects";
import {
  abortTaskWithCertificate,
  consensusMessage,
  finalizeTaskWithCertificate,
  publishCommit,
  publishLeaderIntent,
  publishPartialSignature,
  publishReveal,
  startMediation,
} from "../oracleMessages";
import {
  buildCertificateBlob,
  sha256Hex,
  waitForCommitQuorum,
  waitForPartialQuorum,
  waitForRevealResolution,
} from "../services/eventConsensus";
import { extractNumericScale, extractNumericValue, toConsensusU64 } from "../utils/numeric";

function leaderOrder(assigned: string[]): string[] {
  return [...assigned].map((x) => x.toLowerCase()).sort();
}

function meanFloor(values: number[]): number {
  if (!values.length) return 0;
  return Math.floor(values.reduce((a, b) => a + b, 0) / values.length);
}

function varianceSpread(values: number[]): number {
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

export async function runConsensusRound(
  ctx: NodeContext,
  params: {
    taskId: string;
    round: number;
    normalized: string;
    assignedNodes: string[];
    quorumK: number;
    runtimeId: string;
    configId: string;
    mediationMode: number;
    varianceMax: number;
    numericValueU64: number | null;
  },
): Promise<void> {
  const { client, identity, nodeId, myAddr } = ctx;
  const {
    taskId,
    round,
    normalized,
    assignedNodes,
    quorumK,
    runtimeId,
    configId,
    mediationMode,
    varianceMax,
    numericValueU64,
  } = params;

  const waitMs = optInt("ROUND_WAIT_MS", 45_000);
  const pollMs = optInt("ROUND_POLL_MS", 1_200);
  const resultBytes = new TextEncoder().encode(normalized);
  const resultHashHex = sha256Hex(resultBytes);
  const leaders = leaderOrder(assignedNodes);
  const leaderAddr = leaders[0] ?? "";

  const tx2 = await publishCommit({ client, keypair: identity.keypair, taskId, round, resultHashHex });
  console.log(`[node ${nodeId}] commit published tx=${tx2}`);

  const commits = await waitForCommitQuorum({ client, taskId, round, assignedNodes, quorumK, waitMs, pollMs });
  if (!commits.ok) {
    if (myAddr === leaderAddr) {
      const reasonCode = commits.reason === "no_quorum" ? 1004 : 1002;
      const cert = buildCertificateBlob({ kind: "abort", signers: [myAddr], reasonCode, round });
      const digest = await abortTaskWithCertificate({
        client,
        keypair: identity.keypair,
        taskId,
        runtimeId,
        reasonCode,
        multisigBytes: cert,
        multisigAddr: myAddr,
        signerAddrs: leaders.slice(0, quorumK),
        certificateBlob: cert,
      }).catch(() => null);

      if (digest) {
        if (commits.reason === "no_quorum") {
          console.log(
            `[node ${nodeId}] abort commit no quorum tx=${digest} no_commit=${commits.noCommitCount ?? "-"} max_possible_commits=${commits.maxPossibleCommits ?? "-"}/${quorumK}`,
          );
        } else {
          console.log(`[node ${nodeId}] abort commit timeout tx=${digest}`);
        }
      }
    }
    return;
  }

  const tx3 = await publishReveal({
    client,
    keypair: identity.keypair,
    taskId,
    round,
    normalizedBytes: resultBytes,
    resultHashHex,
    numericValueU64,
  });
  console.log(`[node ${nodeId}] reveal published tx=${tx3}`);

  const reveal = await waitForRevealResolution({ client, taskId, round, assignedNodes, quorumK, waitMs, pollMs });
  if (!reveal.ok) {
    console.log(`[node ${nodeId}] no winning reveal: ${reveal.reason}`);

    if (reveal.reason === "no_quorum" && mediationMode === 1 && myAddr === leaderAddr && reveal.reveals) {
      const numericValues = [...reveal.reveals.values()]
        .filter((m) => Number(m.value1 ?? 0) === 1)
        .map((m) => Number(m.value0 ?? 0))
        .filter((n) => Number.isFinite(n));

      if (numericValues.length >= quorumK) {
        const mean = meanFloor(numericValues);
        const variance = varianceSpread(numericValues);
        const seed = new TextEncoder().encode(`[${mean}]`);
        const md = await startMediation({
          client,
          keypair: identity.keypair,
          taskId,
          configId,
          runtimeId,
          observedVariance: variance,
          seedBytes: seed,
        }).catch(() => null);

        if (md) {
          console.log(`[node ${nodeId}] mediation started tx=${md} mean=${mean} variance=${variance}`);
          return;
        }
      }
    }

    if (myAddr === leaderAddr && mediationMode !== 1) {
      const cert = buildCertificateBlob({ kind: "abort", signers: [myAddr], reasonCode: 1003, round });
      const digest = await abortTaskWithCertificate({
        client,
        keypair: identity.keypair,
        taskId,
        runtimeId,
        reasonCode: 1003,
        multisigBytes: cert,
        multisigAddr: myAddr,
        signerAddrs: leaders.slice(0, quorumK),
        certificateBlob: cert,
      }).catch(() => null);

      if (digest) console.log(`[node ${nodeId}] abort no quorum tx=${digest}`);
    }
    return;
  }

  console.log(
    `[node ${nodeId}] winning hash=${reveal.resultHashHex} approvals=${reveal.supporters.length}/${assignedNodes.length}`,
  );
  if (resultHashHex !== reveal.resultHashHex) return;

  const tx4 = await publishPartialSignature({ client, keypair: identity.keypair, taskId, round, resultHashHex });
  console.log(`[node ${nodeId}] partial signature published tx=${tx4}`);

  const msgDigestHex = Buffer.from(consensusMessage(taskId, round, resultHashHex))
    .toString("hex")
    .toLowerCase();

  const partials = await waitForPartialQuorum({
    client,
    taskId,
    round,
    signerAddrs: reveal.supporters,
    quorumK,
    messageDigestHex: msgDigestHex,
    waitMs,
    pollMs,
  });

  if (!partials.ok) {
    if (myAddr === leaderAddr) {
      const cert = buildCertificateBlob({ kind: "abort", signers: [myAddr], reasonCode: 1005, round });
      const digest = await abortTaskWithCertificate({
        client,
        keypair: identity.keypair,
        taskId,
        runtimeId,
        reasonCode: 1005,
        multisigBytes: cert,
        multisigAddr: myAddr,
        signerAddrs: leaders.slice(0, quorumK),
        certificateBlob: cert,
      }).catch(() => null);

      if (digest) console.log(`[node ${nodeId}] abort partial timeout tx=${digest}`);
    }
    return;
  }

  const chosenSigners = [...partials.partials.keys()].sort().slice(0, quorumK);
  if (myAddr !== leaderAddr) return;

  // usa le pubkey registrate on-chain e costruisci il multisig
  // con TUTTI gli assigned nodes ordinati, coerentemente con taskSignFlow.ts
  const pubkeysByAddrB64 = await loadPubkeysByAddrB64(client);
  const assignedSorted = assignedNodes.map((a) => a.toLowerCase()).sort();

  const pubsSorted: Array<{ nodeId: string; pubKeyBase64: string }> = [];
  for (const addr of assignedSorted) {
    const pk = pubkeysByAddrB64.get(addr);
    if (!pk) throw new Error(`Missing pubkey for ${addr}`);
    pubsSorted.push({ nodeId: addr, pubKeyBase64: pk });
  }

  const multiPk = buildMultiSigPublicKey(quorumK, pubsSorted);
  const multisigAddr = multiPk.toIotaAddress();

  const cert = buildCertificateBlob({
    kind: "finalize",
    signers: chosenSigners,
    resultHashHex,
    round,
  });

  const details = new TextEncoder().encode(
    JSON.stringify({
      mode: 1,
      hash: resultHashHex,
      signers: chosenSigners,
      round,
      multisigAddr,
    }),
  );

  await publishLeaderIntent({
    client,
    keypair: identity.keypair,
    taskId,
    round,
    finalizeMode: 1,
    details,
  }).catch(() => null);

  const digest = await finalizeTaskWithCertificate({
    client,
    keypair: identity.keypair,
    taskId,
    runtimeId,
    resultBytes,
    multisigBytes: cert,
    multisigAddr,
    signerAddrs: chosenSigners,
    certificateBlob: cert,
    finalizeMode: round > 0 ? 2 : 1,
  }).catch(() => null);

  if (digest) console.log(`[node ${nodeId}] finalize tx=${digest}`);
}

async function maybeAbortCommitNoQuorum(opts: {
  ctx: NodeContext;
  taskId: string;
  round: number;
  assignedNodes: string[];
  quorumK: number;
  runtimeId: string;
}) {
  const { ctx, taskId, round, assignedNodes, quorumK, runtimeId } = opts;
  const { client, identity, nodeId, myAddr } = ctx;
  const leaders = leaderOrder(assignedNodes);
  const leaderAddr = leaders[0] ?? "";
  if (myAddr !== leaderAddr) return;

  const waitMs = optInt("ROUND_WAIT_MS", 45_000);
  const pollMs = optInt("ROUND_POLL_MS", 1_200);
  const commits = await waitForCommitQuorum({ client, taskId, round, assignedNodes, quorumK, waitMs, pollMs });
  if (commits.ok) return;

  const reasonCode = commits.reason === "no_quorum" ? 1004 : 1002;
  const cert = buildCertificateBlob({ kind: "abort", signers: [myAddr], reasonCode, round });
  const digest = await abortTaskWithCertificate({
    client,
    keypair: identity.keypair,
    taskId,
    runtimeId,
    reasonCode,
    multisigBytes: cert,
    multisigAddr: myAddr,
    signerAddrs: leaders.slice(0, quorumK),
    certificateBlob: cert,
  }).catch(() => null);

  if (!digest) return;

  if (commits.reason === "no_quorum") {
    console.log(
      `[node ${nodeId}] abort commit no quorum tx=${digest} no_commit=${commits.noCommitCount ?? "-"} max_possible_commits=${commits.maxPossibleCommits ?? "-"}/${quorumK}`,
    );
  } else {
    console.log(`[node ${nodeId}] abort commit timeout tx=${digest}`);
  }
}

export async function processAssigned(ctx: NodeContext, taskId: string, creator: string): Promise<void> {
  const { client, identity, nodeId, myAddr, acceptedTemplateIds, cache } = ctx;

  const bundle = await loadTaskBundle(client, taskId);
  const { taskFields, configFields, runtimeFields, configId, runtimeId } = bundle;
  if (!isTaskFreshForNode(bundle, ctx.startupMs)) {
    const createdAt = taskCreatedAtMs(bundle);
    console.log(`[node ${nodeId}] ignore stale task=${taskId} created_at_ms=${createdAt} startup_ms=${ctx.startupMs}`);
    return;
  }

  const round = Number(taskFields.active_round ?? 0) || 0;
  const roundKey = `${taskId}:${round}:assigned:v2`;
  if (!cache.markRoundSeen(roundKey)) return;

  const state = Number(taskFields.state ?? -1);
  if (![1, 2].includes(state)) return;

  const assignedNodes: string[] = Array.isArray(taskFields.assigned_nodes)
    ? taskFields.assigned_nodes.map((x: any) => String(x).toLowerCase())
    : [];
  if (!assignedNodes.includes(myAddr)) return;

  const taskType = bytesToUtf8(decodeVecU8(taskFields.task_type));
  const payloadStr = bytesToUtf8(decodeVecU8(taskFields.payload));
  const templateId = Number(taskFields.template_id ?? 0);
  const retentionDays = Number(configFields.retention_days ?? 0);
  const paymentIota = String(taskFields.payment_iota ?? "0");
  const mediationMode = Number(configFields.mediation_mode ?? 0);
  const varianceMax = Number(configFields.variance_max ?? 0);

  if (!acceptsTemplate(templateId, acceptedTemplateIds)) return;

  console.log(
    `[node ${nodeId}] assigned task id=${taskId} by=${creator} round=${round} state=${state} type=${taskType} template=${templateId} retention_days=${retentionDays} payment_iota=${paymentIota}`,
  );

  let payloadJson: any;
  try {
    payloadJson = payloadStr ? JSON.parse(payloadStr) : {};
  } catch {
    payloadJson = { raw: payloadStr };
  }

  let normalized = "";
  try {
    normalized = await executeTask({
      taskType,
      payload: payloadJson,
      taskId,
      nodeId,
      templateId,
      declaredDownloadBytes: Number(configFields.declared_download_bytes ?? 0) || undefined,
      retentionDays,
      taskCreatedAtMs: Number(runtimeFields.created_at_ms ?? 0) || taskCreatedAtMs(bundle),
    });
    console.log(`\n[node ${nodeId}] normalized output (first 2000 chars):\n${normalized.slice(0, 2000)}\n`);
  } catch (e: any) {
    const errMsg = String(e?.message ?? e);
    console.error(`[node ${nodeId}] task execution failed: ${errMsg}`);
    try {
      const tx = await publishNoCommit({
        client,
        keypair: identity.keypair,
        taskId,
        round,
        reasonCode: 1,
        message: errMsg,
      });
      console.log(`[node ${nodeId}] no_commit published tx=${tx}`);
      await maybeAbortCommitNoQuorum({
        ctx,
        taskId,
        round,
        assignedNodes,
        quorumK: Number(taskFields.quorum_k ?? assignedNodes.length) || assignedNodes.length,
        runtimeId,
      });
    } catch (txErr: any) {
      console.error(`[node ${nodeId}] no_commit publish failed: ${String(txErr?.message ?? txErr)}`);
    }
    return;
  }

  const numericExtract = extractNumericValue(normalized, payloadJson);
  const numericScale = extractNumericScale(payloadJson);
  const numericValueU64 = numericExtract.value != null ? toConsensusU64(numericExtract.value, numericScale) : null;
  console.log(
    `[node ${nodeId}] numeric extract source=${numericExtract.source} path=${numericExtract.path ?? "-"} raw=${numericExtract.value ?? "-"} scale=${numericScale} u64=${numericValueU64 ?? "-"}`,
  );

  await runConsensusRound(ctx, {
    taskId,
    round,
    normalized,
    assignedNodes,
    quorumK: Number(taskFields.quorum_k ?? assignedNodes.length) || assignedNodes.length,
    runtimeId,
    configId,
    mediationMode,
    varianceMax,
    numericValueU64,
  });
}

export async function replayRecentAssignments(ctx: NodeContext, limit = 50): Promise<void> {
  const { client, myAddr, taskAssignedType, nodeId, startupMs } = ctx;
  try {
    const page: any = await client.queryEvents({
      query: { MoveEventType: taskAssignedType },
      cursor: null,
      limit,
      order: "descending",
    } as any);

    const items = Array.isArray(page?.data) ? [...page.data].reverse() : [];
    for (const ev of items) {
      const evTs = Number((ev as any)?.timestampMs ?? 0);
      if (evTs > 0 && evTs < startupMs) continue;
      const pj: any = ev?.parsedJson ?? {};
      if (Number(pj.kind ?? -1) !== 2) continue;
      const to = String(pj.addr0 ?? "").toLowerCase();
      if (to !== myAddr) continue;
      const taskId = String(pj.task_id ?? "");
      const creator = String(pj.actor ?? "");
      if (taskId) await processAssigned(ctx, taskId, creator);
    }
  } catch (e: any) {
    console.warn(`[node ${nodeId}] replay recent assignments failed (continue): ${e?.message ?? e}`);
  }
}
