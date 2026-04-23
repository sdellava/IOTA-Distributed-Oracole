// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { bytesToUtf8, decodeVecU8 } from '../events';
import type { NodeContext } from '../nodeContext';
import { readRegisteredOracleNodeByAddr } from '../services/schedulerReader';
import { loadTaskBundle, isTaskFreshForNode } from '../services/taskObjects';
import { acceptsTemplate } from '../nodeConfig';
import { savePersistedAcceptedTemplateIds } from '../templateState';
import { moveToArray, moveToString } from '../utils/move';
import { extractNumericValue, toConsensusU64 } from '../utils/numeric';
import { runConsensusRound } from './assigned';

export async function processMediationStarted(
  ctx: NodeContext,
  params: { taskId: string; toRound?: number; runIndex?: number },
): Promise<void> {
  const { client, nodeId, myAddr, cache } = ctx;
  const { taskId } = params;

  const bundle = await loadTaskBundle(client, taskId);
  if (!isTaskFreshForNode(bundle, ctx.startupMs)) {
    console.log(`[node ${nodeId}] ignore mediation task=${taskId} reason=stale`);
    return;
  }
  const { taskFields, configFields, runtimeFields } = bundle;
  const toRound = Number(params.toRound ?? taskFields.active_round ?? 0) || 0;
  const activeRunIndex = Number(params.runIndex ?? taskFields.active_run_index ?? 0) || 0;
  const roundKey = `${taskId}:${activeRunIndex}:${toRound}:mediation:v3`;
  if (!cache.markRoundSeen(roundKey)) {
    console.log(`[node ${nodeId}] ignore duplicate mediation task=${taskId} run=${activeRunIndex} round=${toRound}`);
    return;
  }

  const assignedNodes: string[] = moveToArray(taskFields.assigned_nodes)
    .map((x: any) => moveToString(x).toLowerCase())
    .filter(Boolean);
  if (!assignedNodes.includes(myAddr)) {
    console.log(
      `[node ${nodeId}] ignore mediation task=${taskId} round=${toRound} reason=not_assigned assigned_nodes=${assignedNodes.join(",") || "<none>"} me=${myAddr}`,
    );
    return;
  }

  const templateId = Number(taskFields.template_id ?? 0);
  const myNode = await readRegisteredOracleNodeByAddr(client, myAddr);
  const acceptedTemplateIds = myNode?.acceptedTemplateIds ?? [];
  if (myNode) {
    ctx.acceptedTemplateIds = acceptedTemplateIds;
    savePersistedAcceptedTemplateIds(nodeId, acceptedTemplateIds);
  }
  if (!acceptsTemplate(templateId, acceptedTemplateIds)) {
    console.log(
      `[node ${nodeId}] ignore mediation task=${taskId} round=${toRound} reason=template_not_accepted template=${templateId} accepted=${acceptedTemplateIds.join(",") || "<none>"}`,
    );
    return;
  }

  const seedBytes = decodeVecU8(runtimeFields.mediation_seed_bytes ?? taskFields.mediation_seed_bytes);
  const normalized = bytesToUtf8(seedBytes);
  const numeric = extractNumericValue(normalized, {} as any);
  const numericValueU64 = numeric.value != null ? toConsensusU64(numeric.value, 1) : null;
  console.log(`[node ${nodeId}] mediation round start task=${taskId} run=${activeRunIndex} round=${toRound} seed=${normalized}`);

  await runConsensusRound(ctx, {
    taskId,
    round: toRound,
    runStartedAtMs: Number(taskFields.last_run_ms ?? runtimeFields.last_run_ms ?? 0) || Date.now(),
    normalized,
    assignedNodes,
    quorumK: Number(taskFields.quorum_k ?? assignedNodes.length) || assignedNodes.length,
    mediationMode: Number(configFields.mediation_mode ?? 0),
    varianceMax: Number(configFields.variance_max ?? 0),
    numericValueU64,
  });
}
