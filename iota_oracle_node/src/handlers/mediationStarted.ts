// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { bytesToUtf8, decodeVecU8 } from '../events';
import type { NodeContext } from '../nodeContext';
import { loadTaskBundle, isTaskFreshForNode } from '../services/taskObjects';
import { acceptsTemplate } from '../nodeConfig';
import { extractNumericValue, toConsensusU64 } from '../utils/numeric';
import { runConsensusRound } from './assigned';

export async function processMediationStarted(
  ctx: NodeContext,
  params: { taskId: string; toRound: number },
): Promise<void> {
  const { client, nodeId, myAddr, acceptedTemplateIds, cache } = ctx;
  const { taskId, toRound } = params;
  const roundKey = `${taskId}:${toRound}:mediation:v2`;
  if (!cache.markRoundSeen(roundKey)) return;

  const bundle = await loadTaskBundle(client, taskId);
  if (!isTaskFreshForNode(bundle, ctx.startupMs)) return;
  const { taskFields, configFields, runtimeFields, runtimeId, configId } = bundle;
  const assignedNodes: string[] = Array.isArray(taskFields.assigned_nodes)
    ? taskFields.assigned_nodes.map((x: any) => String(x).toLowerCase())
    : [];
  if (!assignedNodes.includes(myAddr)) return;

  const templateId = Number(taskFields.template_id ?? 0);
  if (!acceptsTemplate(templateId, acceptedTemplateIds)) return;

  const seedBytes = decodeVecU8(runtimeFields.mediation_seed_bytes ?? taskFields.mediation_seed_bytes);
  const normalized = bytesToUtf8(seedBytes);
  const numeric = extractNumericValue(normalized, {} as any);
  const numericValueU64 = numeric.value != null ? toConsensusU64(numeric.value, 1) : null;
  console.log(`[node ${nodeId}] mediation round start task=${taskId} round=${toRound} seed=${normalized}`);

  await runConsensusRound(ctx, {
    taskId,
    round: toRound,
    normalized,
    assignedNodes,
    quorumK: Number(taskFields.quorum_k ?? assignedNodes.length) || assignedNodes.length,
    runtimeId,
    configId,
    mediationMode: Number(configFields.mediation_mode ?? 0),
    varianceMax: Number(configFields.variance_max ?? 0),
    numericValueU64,
  });
}
