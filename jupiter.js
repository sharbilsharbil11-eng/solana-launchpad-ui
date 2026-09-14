/* ================================================================
   Velo — Jupiter market discovery (read-only)
   ================================================================
   Shows real Solana tokens from the wider market (not just ones created
   through Velo's own bonding curve) on the board's "🪐 Market" tab, using
   Jupiter's public Token API — real USD price/market cap/24h change, no
   fabricated numbers.

   This file is pure data/discovery: fetching and normalizing real token
   info from Jupiter. Real buying/selling (real SOL, mainnet, a wallet the
   visitor connects themselves) lives in jupiter-trade.js — kept separate
   since that file is the one place in the app that ever touches a real
   signature.

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
    liquidityUsd: Number(pickField(raw, ['liquidity'], 0)) || 0,
    totalSupply: Number(pickField(raw, ['totalSupply', 'circSupply'], 0)) || 0,
    decimals: Number(pickField(raw, ['decimals'], 9)) || 9,
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

// Single-token lookup by mint address — used by token.html when a mint
// isn't a Velo-native bonding-curve token, to check whether it's a real
// token tradeable on the wider market instead (see token-page.js's
// initJupiterTokenPage). Returns null if Jupiter doesn't know this mint.
async function fetchJupiterTokenByMint(mint) {
  const url = `${JUPITER_TOKEN_API}/search?query=${encodeURIComponent(mint)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Jupiter token lookup failed (${resp.status})`);
  const data = await resp.json();
  const list = Array.isArray(data) ? data : Array.isArray(data?.tokens) ? data.tokens : [];
  const normalized = list.map(normalizeJupiterToken).filter(Boolean);
  return normalized.find((t) => t.mint === mint) || null;
}

function formatUsd(n) {
  if (!isFinite(n) || n === 0) return '$0';
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K';
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toPrecision(3);
}
