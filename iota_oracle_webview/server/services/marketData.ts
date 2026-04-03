const CMC_IOTA_SOURCE_URL = "https://coinmarketcap.com/currencies/iota/";
const CMC_PUBLIC_QUOTE_URL = "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/quote/latest?id=1720";
const DEFAULT_CACHE_TTL_MS = 60_000;

export type IotaMarketPrice = {
  symbol: "IOTA";
  quoteCurrency: "USD";
  usdPrice: number;
  sourceName: "CoinMarketCap";
  sourceUrl: string;
  fetchedAtIso: string;
  cacheTtlMs: number;
};

type CacheState = {
  value: IotaMarketPrice | null;
  fetchedAtMs: number;
};

const cache: CacheState = {
  value: null,
  fetchedAtMs: 0,
};

function asFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function extractUsdPriceFromPayload(payload: unknown): number | null {
  const root = payload as any;
  const directCandidates: unknown[] = [
    root?.data?.[0]?.quotes?.[0]?.price,
    root?.data?.[0]?.quote?.USD?.price,
    root?.data?.[1720]?.quote?.USD?.price,
    root?.data?.["1720"]?.quote?.USD?.price,
    root?.data?.IOTA?.[0]?.quote?.USD?.price,
    root?.data?.IOTA?.quote?.USD?.price,
  ];

  for (const candidate of directCandidates) {
    const parsed = asFiniteNumber(candidate);
    if (parsed != null) return parsed;
  }

  const quotes = Array.isArray(root?.data?.quotes) ? root.data.quotes : [];
  for (const q of quotes) {
    const code = String(q?.name ?? q?.symbol ?? "").trim().toUpperCase();
    if (code !== "USD") continue;
    const parsed = asFiniteNumber(q?.price);
    if (parsed != null) return parsed;
  }

  return null;
}

async function fetchIotaPriceFromCoinMarketCap(ttlMs: number): Promise<IotaMarketPrice> {
  const response = await fetch(CMC_PUBLIC_QUOTE_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`CoinMarketCap request failed: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const usdPrice = extractUsdPriceFromPayload(payload);
  if (usdPrice == null) {
    throw new Error("CoinMarketCap response does not contain a valid IOTA/USD price.");
  }

  return {
    symbol: "IOTA",
    quoteCurrency: "USD",
    usdPrice,
    sourceName: "CoinMarketCap",
    sourceUrl: CMC_IOTA_SOURCE_URL,
    fetchedAtIso: new Date().toISOString(),
    cacheTtlMs: ttlMs,
  };
}

export async function getIotaMarketPrice(): Promise<IotaMarketPrice> {
  const ttlMs = Number(process.env.IOTA_PRICE_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS) || DEFAULT_CACHE_TTL_MS;
  const now = Date.now();
  if (cache.value && now - cache.fetchedAtMs < ttlMs) {
    return cache.value;
  }

  const fresh = await fetchIotaPriceFromCoinMarketCap(ttlMs);
  cache.value = fresh;
  cache.fetchedAtMs = now;
  return fresh;
}
