export function normalizeAddress(addr: string): string {
  return String(addr ?? "").trim().toLowerCase();
}

export function selectCoordinator(assignedNodes: string[]): string {
  return assignedNodes.map(normalizeAddress).filter(Boolean).sort()[0] ?? "";
}

export function isCoordinator(myAddr: string, assignedNodes: string[]): boolean {
  const mine = normalizeAddress(myAddr);
  return !!mine && mine === selectCoordinator(assignedNodes);
}
