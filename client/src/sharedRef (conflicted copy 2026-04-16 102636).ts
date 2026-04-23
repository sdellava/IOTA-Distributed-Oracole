// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { IotaClient } from '@iota/iota-sdk/client';

export type SharedRef = {
  objectId: string;
  initialSharedVersion: string;
  mutable: boolean;
};

export async function resolveSharedRef(client: IotaClient, objectId: string, mutable = false): Promise<SharedRef> {
  const obj = await client.getObject({ id: objectId, options: { showOwner: true } });
  const owner: any = obj.data?.owner;
  const shared = owner?.Shared;
  if (!shared?.initial_shared_version) {
    throw new Error(`Object ${objectId} is not Shared (owner=${JSON.stringify(owner)})`);
  }
  return {
    objectId,
    initialSharedVersion: String(shared.initial_shared_version),
    mutable,
  };
}
