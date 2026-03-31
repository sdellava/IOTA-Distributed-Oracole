export type TaskCacheEntry = {
  taskId: string;
  round: number;
  taskType: string;
  payloadJson: any;
  normalizedText: string;
  resultBytes: Uint8Array;
  resultHashHex: string;
  assignedNodes: string[];
  quorumK: number;
  leaderAddr: string;
  pubkeysByAddrB64: Map<string, string>;
  mediationMode: number;
  varianceMax: number;
  numericValue: number | null;
  numericScale: number;
  numericValueU64: number | null;
};

export class TaskCache {
  private readonly cache = new Map<string, TaskCacheEntry>();
  private readonly seenTaskRounds = new Set<string>();
  private readonly phaseOnce = new Set<string>();

  public set(entry: TaskCacheEntry): void {
    this.cache.set(this.entryKey(entry.taskId, entry.round), entry);
  }

  public get(taskId: string, round: number): TaskCacheEntry | undefined {
    return this.cache.get(this.entryKey(taskId, round));
  }

  public markRoundSeen(key: string): boolean {
    if (this.seenTaskRounds.has(key)) return false;
    this.seenTaskRounds.add(key);
    return true;
  }

  public runOnce(key: string): boolean {
    if (this.phaseOnce.has(key)) return false;
    this.phaseOnce.add(key);
    return true;
  }

  private entryKey(taskId: string, round: number): string {
    return `${taskId}:${round}`;
  }
}
