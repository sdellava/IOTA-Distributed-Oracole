type JsonNorm = {
  kind?: "json";
  canonical?: boolean;
  dropNulls?: boolean;
  dropKeys?: string[];
  sortArrays?: boolean;
};

function isObject(x: any): x is Record<string, any> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function dropPath(root: any, path: string): void {
  const parts = String(path ?? "").split(".").filter(Boolean);
  if (parts.length === 0) return;

  function rec(node: any, idx: number): void {
    if (node == null) return;
    const key = parts[idx];

    if (idx === parts.length - 1) {
      if (isObject(node) && Object.prototype.hasOwnProperty.call(node, key)) delete node[key];
      return;
    }

    if (isObject(node) && Object.prototype.hasOwnProperty.call(node, key)) {
      rec(node[key], idx + 1);
      return;
    }

    // if the path hits arrays, try apply on each item (best effort)
    if (Array.isArray(node)) {
      for (const it of node) rec(it, idx);
    }
  }

  rec(root, 0);
}

function removeNulls(x: any): any {
  if (Array.isArray(x)) {
    const out = x.map(removeNulls).filter((v) => v !== null && v !== undefined);
    return out;
  }
  if (isObject(x)) {
    const out: Record<string, any> = {};
    for (const k of Object.keys(x)) {
      const v = removeNulls(x[k]);
      if (v === null || v === undefined) continue;
      out[k] = v;
    }
    return out;
  }
  return x;
}

function stableStringify(x: any): string {
  if (x === null) return "null";
  if (typeof x === "number" || typeof x === "boolean") return JSON.stringify(x);
  if (typeof x === "string") return JSON.stringify(x);
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(",")}]`;
  if (isObject(x)) {
    const keys = Object.keys(x).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(x[k])}`).join(",")}}`;
  }
  // fallback (undefined, function, bigint)
  return JSON.stringify(x);
}

function sortArraysDeep(x: any): any {
  if (Array.isArray(x)) {
    const mapped = x.map(sortArraysDeep);
    const sorted = mapped
      .map((v) => ({ v, k: stableStringify(v) }))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
      .map((o) => o.v);
    return sorted;
  }
  if (isObject(x)) {
    const out: Record<string, any> = {};
    for (const k of Object.keys(x)) out[k] = sortArraysDeep(x[k]);
    return out;
  }
  return x;
}

export function normalizeJsonCanonical(obj: any, norm: JsonNorm): string {
  let x: any = obj;

  const dropKeys = Array.isArray(norm?.dropKeys) ? norm.dropKeys : [];
  for (const p of dropKeys) dropPath(x, p);

  if (norm?.dropNulls) x = removeNulls(x);
  if (norm?.sortArrays) x = sortArraysDeep(x);

  // canonical implies stable stringify with sorted keys
  if (norm?.canonical ?? true) return stableStringify(x);
  return JSON.stringify(x);
}
