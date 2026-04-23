// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { IotaClient } from "@iota/iota-sdk/client";

import { decodeVecU8 } from "../events";
import { getStateId } from "../config/env";
import { resolveNodeRegistryId } from "./nodeRegistry";
import { getAnyMoveFields, getMoveFields, normalizeEd25519Raw32 } from "../utils/move";

export async function loadPubkeysByAddrB64(client: IotaClient): Promise<Map<string, string>> {
  const stateId = getStateId();
  const nodeRegistryId = await resolveNodeRegistryId(client, stateId);
  const stObj = await client.getObject({ id: nodeRegistryId, options: { showContent: true, showType: true } });
  const stFields = getMoveFields(stObj);
  const oracleNodes: any[] = Array.isArray(stFields.oracle_nodes) ? stFields.oracle_nodes : [];

  const out = new Map<string, string>();
  for (const n of oracleNodes) {
    const nf = getAnyMoveFields(n);
    const addr = String(nf?.addr ?? "").toLowerCase();
    const pkBytes = normalizeEd25519Raw32(decodeVecU8(nf?.pubkey));
    if (!addr || pkBytes.length === 0) continue;
    out.set(addr, Buffer.from(pkBytes).toString("base64"));
  }
  return out;
}
