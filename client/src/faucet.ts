export async function requestFaucetIfEnabled(address: string) {
  const auto = (process.env.AUTO_FAUCET ?? '').toLowerCase();
  if (!(auto === 'true' || auto === '1' || auto === 'yes')) return;

  const faucetUrl = process.env.IOTA_FAUCET_URL?.trim();
  if (!faucetUrl) return;

  try {
    const body = { FixedAmountRequest: { recipient: address } };
    const res = await fetch(faucetUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`[faucet] request failed: ${res.status} ${res.statusText} ${txt}`);
      return;
    }

    const json = await res.json().catch(() => null);
    console.log('[faucet] ok', json ?? '');
  } catch (e: any) {
    console.warn('[faucet] error', e?.message ?? e);
  }
}
