// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { IotaClient } from "@iota/iota-sdk/client";

import { getConfiguredNodeRegistryId, getStateId } from "../config/env";
import { getMoveFields, moveToString } from "../utils/move";

export async function resolveNodeRegistryId(
  client: IotaClient,
  stateId = getStateId(),
): Promise<string> {
  const configured = getConfiguredNodeRegistryId()?.trim();
  if (configured) return configured;

  const stateObj = await client.getObject({
    id: stateId,
    options: { showContent: true },
  } as any);
  const stateFields = getMoveFields(stateObj);
  const registryId = moveToString(stateFields.node_registry_id).trim();
  if (!registryId) {
    throw new Error(`State ${stateId} does not expose node_registry_id`);
  }
  return registryId;
}
