import type { NodeContext } from '../nodeContext';

export async function processDataRequested(
  _ctx: NodeContext,
  _params: { taskId: string; failedRound: number },
): Promise<void> {
  // No-op in the event-based protocol.
}
