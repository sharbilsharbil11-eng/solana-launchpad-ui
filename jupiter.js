/* ================================================================
   Velo — Jupiter market discovery (read-only)
   ================================================================
   Shows real Solana tokens from the wider market (not just ones created
   through Velo's own bonding curve) on the board's "🪐 Market" tab, using
   Jupiter's public Token API — real USD price/market cap/24h change, no
   fabricated numbers.

   Deliberately NOT wired to buying/swapping yet: Jupiter only has
   liquidity on Solana mainnet, while every other part of this app (the
   in-app wallet, the bonding-curve program) runs on devnet with free
   test SOL. Actually letting someone swap into one of these tokens would
   need a mainnet wallet holding real SOL — a real-money feature that
   needs its own explicit decision, not something to fold in silently
   here. This file is discovery-only: real data, no funds at risk.

   IMPORTANT — could not verify live: the sandbox this was written in has
   no network access to Jupiter's API (same restriction documented in
   anchor-program/README.md for Solana RPC/devnet), so the exact response
   field names below are best-effort from documented/typical Jupiter
   Token API v2 shapes, not confirmed against a live response. pickField()
   tries several plausible field names per value specifically so a minor
   naming difference doesn't silently break everything — but this should
   still get one real, live check before relying on it.
   ================================================================ */

const JUPITER_TOKEN_API = 'https://lite-api.jup.ag/tokens/v2';

function pickField(obj, names, fallback) {
  for (const name of names) {
    const value = name.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

function normalizeJupiterToken(raw) {
  const mint = pickField(raw, ['id', 'address', 'mint']);
  if (!mint) return null;
  return {
    mint,
    symbol: pickField(raw, ['symbol'], ''),
    name: pickField(raw, ['name'], ''),
    icon: pickField(raw, ['icon', 'logoURI'], null),
    priceUsd: Number(pickField(raw, ['usdPrice', 'price'], 0)) || 0,
    marketCapUsd: Number(pickField(raw, ['mcap', 'marketCap', 'fdv'], 0)) || 0,
    change24h: Number(pickField(raw, ['stats24h.priceChange', 'priceChange24h', 'change24h'], 0)) || 0,
  };
}

// Real trending Solana tokens (by Jupiter's own organic-activity ranking
// over the last 24h) — one HTTP call, no API key needed for this endpoint.
async function fetchJupiterTrendingTokens({ limit = 20 } = {}) {
  const url = `${JUPITER_TOKEN_API}/toporganicscore/24h?limit=${encodeURIComponent(limit)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Jupiter token API returned ${resp.status}`);
  const data = await resp.json();
  const list = Array.isArray(data) ? data : Array.isArray(data?.tokens) ? data.tokens : [];
  return list.map(normalizeJupiterToken).filter(Boolean);
}

function formatUsd(n) {
  if (!isFinite(n) || n === 0) return '$0';
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toPrecision(3);
}
