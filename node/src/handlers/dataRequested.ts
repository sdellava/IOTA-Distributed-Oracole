// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import type { NodeContext } from '../nodeContext';

export async function processDataRequested(
  _ctx: NodeContext,
  _params: { taskId: string; failedRound: number },
): Promise<void> {
  // No-op in the event-based protocol.
}
