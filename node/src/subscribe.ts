// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { IotaClient } from '@iota/iota-sdk/client';

export async function subscribeSenderEvents(client: IotaClient, sender: string): Promise<() => Promise<void>> {
  const unsubscribe = await (client as any).subscribeEvent({
    filter: { Sender: sender },
    onMessage: (event: unknown) => {
      console.log('[subscribeEvent]', JSON.stringify(event, null, 2));
    },
  });

  return async () => {
    await unsubscribe();
  };
}
