// Copyright (c) 2026 Stefano Della Valle
// SPDX-License-Identifier: LicenseRef-Proprietary

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Ed25519Keypair, Ed25519PublicKey } from "@iota/iota-sdk/keypairs/ed25519";
import type { NodeKeyInfo } from "../types.js";

function keyDir(baseDir: string) {
  return join(baseDir, "keys");
}

export async function loadOrCreateNodeKey(baseDir: string, nodeId: string): Promise<{ keyInfo: NodeKeyInfo; kp: Ed25519Keypair }> {
  const dir = keyDir(baseDir);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `node_${nodeId}.json`);

  if (existsSync(path)) {
    const keyInfo = JSON.parse(await readFile(path, "utf8")) as NodeKeyInfo;
    const kp = Ed25519Keypair.fromSecretKey(keyInfo.secretKey);
    return { keyInfo, kp };
  }

  const kp = new Ed25519Keypair();
  const pub = kp.getPublicKey();
  const keyInfo: NodeKeyInfo = {
    nodeId,
    secretKey: kp.getSecretKey(),
    publicKeyBase64: pub.toBase64(),
    address: pub.toIotaAddress(),
    createdAt: new Date().toISOString(),
  };
  await writeFile(path, JSON.stringify(keyInfo, null, 2), "utf8");
  return { keyInfo, kp };
}

export function publicKeyFromBase64(b64: string): Ed25519PublicKey {
  return new Ed25519PublicKey(b64);
}
