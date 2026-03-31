import fs from 'node:fs';
import path from 'node:path';
import { decodeIotaPrivateKey } from '@iota/iota-sdk/cryptography';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';

export type NodeIdentity = {
  nodeId: string;
  secretKeyBech32: string;
  keypair: Ed25519Keypair;
  address: string;
  publicKeyBytes: Uint8Array;
};

export function loadOrCreateNodeIdentity(nodeId: string): NodeIdentity {
  const dir = path.resolve(process.cwd(), 'keys');
  fs.mkdirSync(dir, { recursive: true });

  const fp = path.join(dir, `oracle_node_${nodeId}.iotaprivkey`);

  let secretKeyBech32: string;
  let keypair: Ed25519Keypair;

  if (fs.existsSync(fp)) {
    secretKeyBech32 = fs.readFileSync(fp, 'utf8').trim();
    const parsed = decodeIotaPrivateKey(secretKeyBech32);
    if (parsed.schema !== 'ED25519') {
      throw new Error(`Unsupported key schema in ${fp}: ${parsed.schema}`);
    }
    keypair = Ed25519Keypair.fromSecretKey(parsed.secretKey);
  } else {
    keypair = new Ed25519Keypair();
    secretKeyBech32 = keypair.getSecretKey();
    fs.writeFileSync(fp, secretKeyBech32, 'utf8');
  }

  const publicKeyBytes = keypair.getPublicKey().toRawBytes();
  const address = keypair.getPublicKey().toIotaAddress();

  return { nodeId, secretKeyBech32, keypair, address, publicKeyBytes };
}
