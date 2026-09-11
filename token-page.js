/* ================================================================
   Velo — real token detail page (token.html?mint=...)
   ================================================================
   Loads live on-chain state for one bonding-curve token and wires
   Buy/Sell to the real program (bonding-curve.js). Only activates
   when the page is opened with a ?mint= query param — e.g. right
   after a real on-chain token creation redirects here. Without it,
   token.html keeps showing its static demo content untouched.

   Trades and holders are read straight from chain (see the
   fetchRecentTrades/fetchHolders comment in bonding-curve.js for the
   honest limitations of doing this without a backend indexer): no
   deep history, no rolling real 24h volume — just what a handful of
   RPC calls can see right now. The price chart is built from those
   same real trades, bucketed by whichever timeframe tab is active.
   ================================================================ */

const CHART_TIMEFRAME_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400 };

let veloRealToken = null; // { mint, curve, global, trades, holders, holderCount }
let veloChartTimeframe = '5m';

function formatSolAmount(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
// Per-token price on a bonding curve is routinely far below 6 decimals
// (a billion-token supply against modest starting liquidity), so a fixed
// 6-decimal format silently rounds real prices down to "0". Show enough
// decimals to keep a few significant figures instead.
function formatPriceInSol(n) {
  if (!isFinite(n) || n === 0) return '0';
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  const magnitude = Math.floor(Math.log10(Math.abs(n)));
  const decimals = Math.min(12, Math.max(6, -magnitude + 3));
  return n.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}
function formatWholeTokens(n) {
  return Math.round(n).toLocaleString();
}
function timeAgo(blockTimeSeconds) {
  if (!blockTimeSeconds) return '—';
  const diff = Math.max(0, Date.now() / 1000 - blockTimeSeconds);
  if (diff < 60) return Math.floor(diff) + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function curvePriceInSol(curve) {
  // Instantaneous marginal price implied by the curve's virtual reserves —
  // the same x*y=k model the program itself prices trades against.
  const sol = Number(curve.virtualSolReserves) / Number(solanaWeb3.LAMPORTS_PER_SOL);
  const tokens = Number(curve.virtualTokenReserves) / 10 ** TOKEN_DECIMALS;
  return tokens > 0 ? sol / tokens : 0;
}

async function initRealTokenPage(mintStr) {
  veloRealToken = { mint: mintStr, curve: null, global: null, trades: [], holders: [], holderCount: null };
  setText('chartTokenPrice', 'Loading…');

  applyTokenIdentity(mintStr, loadTokenMeta(mintStr));

  let mintPubkey;
  try {
    mintPubkey = new solanaWeb3.PublicKey(mintStr);
  } catch (err) {
    showTokenLoadError('Invalid token address in the link.');
    return;
  }

  const connection = new solanaWeb3.Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  let curve, global;
  try {
    [curve, global] = await Promise.all([
      fetchBondingCurve(connection, mintPubkey),
      fetchGlobal(connection),
    ]);
  } catch (err) {
    console.error('Failed to load token from chain:', err);
    showTokenLoadError('Could not reach Solana right now. Check your connection and try again.');
    return;
  }

  if (!curve) {
    showTokenLoadError('No bonding curve found for this token on ' + SOLANA_RPC_ENDPOINT.replace('https://', '') + ' — it may not be deployed on this network.');
    return;
  }

  veloRealToken.curve = curve;
  veloRealToken.global = global;
  applyCurveState(curve);
  wireTradeButton(connection, mintPubkey);

  // Independent of the curve state above — don't block the price/info
  // render on these.
  loadRealTrades(connection, mintPubkey);
  loadRealHolders(connection, mintPubkey, curve);
}

function applyTokenIdentity(mintStr, meta) {
  const name = meta?.name || shortenAddress(mintStr);
  const ticker = meta?.ticker || '';
  const nameEl = document.getElementById('chartTokenName');
  if (nameEl) {
    nameEl.innerHTML = escapeHtml(name) + (ticker ? ` <span class="chart-token-ticker">$${escapeHtml(ticker)}</span>` : '');
  }
  document.title = (ticker ? '$' + ticker : name) + ' — Velo';
  const imgEl = document.getElementById('chartTokenImg');
  if (imgEl) imgEl.textContent = '🪙';
}

function showTokenLoadError(message) {
  const priceEl = document.getElementById('chartTokenPrice');
  if (priceEl) { priceEl.textContent = 'Unavailable'; priceEl.style.color = 'var(--red)'; }
  showTradeStatus(message, 'var(--red)');
  const tradeBtn = document.getElementById('tradeBtn');
  if (tradeBtn) tradeBtn.disabled = true;
}

function applyCurveState(curve) {
  const price = curvePriceInSol(curve);
  const totalSupplyTokens = Number(curve.tokenTotalSupply) / 10 ** TOKEN_DECIMALS;
  const marketCapSol = price * totalSupplyTokens;
  const liquiditySol = Number(curve.realSolReserves) / Number(solanaWeb3.LAMPORTS_PER_SOL);
  const progressPct = Math.min(100, (Number(curve.realSolReserves) / Number(CURVE_COMPLETE_SOL_THRESHOLD_LAMPORTS)) * 100);

  const priceEl = document.getElementById('chartTokenPrice');
  if (priceEl) { priceEl.textContent = formatPriceInSol(price) + ' SOL'; priceEl.style.color = ''; }

  setText('infoMarketCap', formatSolAmount(marketCapSol) + ' SOL');
  setText('infoLiquidity', formatSolAmount(liquiditySol) + ' SOL');
  setText('infoSupply', formatWholeTokens(totalSupplyTokens));
  setText('infoCreator', shortenAddress(curve.creator.toBase58()));
  setText('infoStatus', curve.complete ? '🎓 Graduated' : '🟢 Active');
  setText('infoProgressPct', progressPct.toFixed(1) + '%');
  // No price oracle or volume indexer is wired up — label this honestly as
  // recent activity over whatever trade history we actually fetched,
  // rather than implying a real rolling 24h figure.
  setText('infoVolumeLabel', 'Recent Volume');

  const bar = document.getElementById('infoProgressBar');
  if (bar) bar.style.width = progressPct.toFixed(1) + '%';

  if (curve.complete) {
    const tradeBtn = document.getElementById('tradeBtn');
    if (tradeBtn) { tradeBtn.disabled = true; tradeBtn.textContent = 'Curve graduated — trading moved to an AMM'; }
  }

  if (currentWallet) {
    fetchWalletBalance(currentWallet.publicKey).then((sol) => {
      if (sol != null) setText('tradeBalanceLabel', sol.toFixed(4) + ' SOL');
    });
  }

  renderChart(veloRealToken.trades, price);
}

function wireTradeButton(connection, mintPubkey) {
  const btn = document.getElementById('tradeBtn');
  const amountInput = document.getElementById('tradeAmountInput');
  if (!btn || !amountInput) return;

  btn.onclick = async () => {
    const amount = parseFloat(amountInput.value);
    const mode = btn.dataset.mode || 'buy';

    if (!amount || amount <= 0) { showTradeStatus('Enter an amount first.', 'var(--red)'); return; }
    if (!currentWallet) { showTradeStatus('Your Velo wallet is still generating — wait a moment and try again.', 'var(--red)'); return; }

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = mode === 'buy' ? 'Buying…' : 'Selling…';
    showTradeStatus('Sending transaction…', 'var(--text-secondary)');

    try {
      const result = mode === 'buy'
        ? await buyOnChain({ mint: mintPubkey.toBase58(), solAmount: amount })
        : await sellOnChain({ mint: mintPubkey.toBase58(), tokenAmount: amount });

      const statusEl = document.getElementById('tradeStatus');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--green)';
        statusEl.innerHTML = `✅ Trade confirmed — <a href="https://explorer.solana.com/tx/${result.signature}?cluster=devnet" target="_blank" rel="noopener" style="color:var(--green);text-decoration:underline;">view transaction</a>`;
      }
      amountInput.value = '';

      // Refresh curve state + trades so price/mcap/progress and the trade
      // list reflect this trade immediately, not just on next page load.
      const [curve] = await Promise.all([
        fetchBondingCurve(connection, mintPubkey),
        fetchGlobal(connection).then((g) => { veloRealToken.global = g; }),
      ]);
      veloRealToken.curve = curve;
      applyCurveState(curve);
      loadRealTrades(connection, mintPubkey);
      loadRealHolders(connection, mintPubkey, curve);
    } catch (err) {
      console.error('Trade failed:', err);
      showTradeStatus('Failed: ' + (err && err.message ? err.message : 'Unknown error.'), 'var(--red)');
    } finally {
      btn.disabled = false;
      if (!veloRealToken.curve || !veloRealToken.curve.complete) btn.textContent = originalText;
    }
  };
}

function showTradeStatus(text, color) {
  const el = document.getElementById('tradeStatus');
  if (!el) return;
  el.style.display = 'block';
  el.style.color = color;
  el.textContent = text;
}

// Buying spends SOL, selling spends the token itself — keep the amount
// input's unit label honest about which one is being entered.
function onTradeModeChanged(mode) {
  const label = document.getElementById('tradeInputSuffixLabel');
  if (!label) return;
  if (mode === 'buy') {
    label.textContent = 'SOL';
  } else {
    const ticker = (veloRealToken && loadTokenMeta(veloRealToken.mint)?.ticker) || 'TOKEN';
    label.textContent = ticker;
  }
}

async function loadRealTrades(connection, mintPubkey) {
  const tbody = document.getElementById('tradesTableBody');
  if (tbody) tbody.innerHTML = loadingRow(5, 'Loading recent trades…');

  let trades = [];
  try {
    trades = await fetchRecentTrades(connection, mintPubkey, { limit: 20 });
  } catch (err) {
    console.error('Failed to load trades:', err);
    if (tbody) tbody.innerHTML = loadingRow(5, 'Could not load trade history.');
    return;
  }

  veloRealToken.trades = trades;
  renderTradesTable(trades);
  renderChart(trades, veloRealToken.curve ? curvePriceInSol(veloRealToken.curve) : 0);

  const totalVolumeSol = trades.reduce((sum, t) => sum + t.solAmount, 0);
  setText('infoVolume', formatSolAmount(totalVolumeSol) + ' SOL');
}

function loadingRow(colspan, text) {
  return `<tr><td colspan="${colspan}" style="text-align:center;color:var(--text-muted);padding:20px;">${escapeHtml(text)}</td></tr>`;
}

function renderTradesTable(trades) {
  const tbody = document.getElementById('tradesTableBody');
  if (!tbody) return;

  const ticker = (loadTokenMeta(veloRealToken.mint)?.ticker) || 'tokens';
  const amountHeader = document.querySelector('#tab-trades thead th:nth-child(3)');
  if (amountHeader) amountHeader.textContent = `Amount (${ticker})`;

  if (!trades.length) {
    tbody.innerHTML = loadingRow(5, 'No trades yet — be the first to buy.');
    return;
  }

  tbody.innerHTML = trades.map((t) => `
    <tr>
      <td><span class="tx-type ${t.type}">${t.type.toUpperCase()}</span></td>
      <td>${t.solAmount.toFixed(4)}</td>
      <td>${formatWholeTokens(t.tokenAmount)}</td>
      <td>${timeAgo(t.blockTime)}</td>
      <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);">${shortenAddress(t.maker)}</td>
    </tr>
  `).join('');
}

async function loadRealHolders(connection, mintPubkey, curve) {
  const list = document.getElementById('holderList');
  if (list) list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Loading holders…</div>';

  let holders = [];
  let holderCount = null;
  try {
    [holders, holderCount] = await Promise.all([
      fetchHolders(connection, mintPubkey, { topN: 10 }),
      fetchHolderCount(connection, mintPubkey),
    ]);
  } catch (err) {
    console.error('Failed to load holders:', err);
    if (list) list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">Could not load holders.</div>';
    return;
  }

  veloRealToken.holders = holders;
  veloRealToken.holderCount = holderCount;
  setText('infoHolders', holderCount != null ? holderCount.toLocaleString() : '—');
  renderHoldersList(holders, curve, holderCount);
}

function renderHoldersList(holders, curve, holderCount) {
  const list = document.getElementById('holderList');
  if (!list) return;
  const totalSupplyRaw = curve ? curve.tokenTotalSupply : 0n;

  if (!holders.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;">No holders yet.</div>';
    return;
  }

  let shownRaw = 0n;
  const rows = holders.map((h, i) => {
    shownRaw += h.amountRaw;
    const pct = totalSupplyRaw > 0n ? (Number(h.amountRaw) / Number(totalSupplyRaw)) * 100 : 0;
    const label = h.isCurve ? 'Bonding Curve (Locked)' : shortenAddress(h.owner);
    const pctClass = h.isCurve ? 'holder-pct green' : 'holder-pct';
    return holderRow(i + 1, label, pct, pctClass);
  });

  if (holderCount != null && holderCount > holders.length) {
    const othersRaw = totalSupplyRaw - shownRaw;
    const othersPct = totalSupplyRaw > 0n && othersRaw > 0n ? (Number(othersRaw) / Number(totalSupplyRaw)) * 100 : 0;
    rows.push(holderRow(holders.length + 1, `Others (${(holderCount - holders.length).toLocaleString()})`, othersPct, 'holder-pct'));
  }

  list.innerHTML = rows.join('');
}

function holderRow(rank, label, pct, pctClass) {
  const pctStr = pct.toFixed(1);
  return `<div class="holder-row"><span class="holder-rank">${rank}</span><span class="holder-addr">${escapeHtml(label)}</span><span class="${pctClass}">${pctStr}%</span><div class="holder-bar"><div class="holder-bar-fill" style="width:${pctStr}%"></div></div></div>`;
}

// Timeframe buttons already toggle their own .active class (see app.js);
// re-bucket the real chart on top of that, but only once a real token is
// loaded — leave the static demo chart alone otherwise.
document.addEventListener('click', (e) => {
  if (!e.target.classList.contains('chart-tf-btn')) return;
  if (!veloRealToken || !veloRealToken.curve) return;
  veloChartTimeframe = e.target.textContent.trim();
  renderChart(veloRealToken.trades, curvePriceInSol(veloRealToken.curve));
});

function bucketTrades(chronologicalTrades, bucketSeconds, fallbackPrice) {
  if (!chronologicalTrades.length) return [{ price: fallbackPrice || 0 }];
  const buckets = new Map();
  for (const t of chronologicalTrades) {
    const key = Math.floor(t.blockTime / bucketSeconds);
    buckets.set(key, t.price); // last trade in the bucket wins (its close price)
  }
  return Array.from(buckets.keys()).sort((a, b) => a - b).map((k) => ({ price: buckets.get(k) }));
}

function renderChart(trades, currentPrice) {
  const linePath = document.getElementById('chartLinePath');
  const areaPath = document.getElementById('chartAreaPath');
  if (!linePath || !areaPath) return;

  const chronological = [...trades].reverse().filter((t) => t.blockTime);
  const bucketSeconds = CHART_TIMEFRAME_SECONDS[veloChartTimeframe] || 300;
  const points = bucketTrades(chronological, bucketSeconds, currentPrice);

  const width = 800, height = 400;
  const prices = points.map((p) => p.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const span = maxPrice - minPrice || maxPrice || 1;

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? (i / (points.length - 1)) * width : width;
    const y = height - 40 - ((p.price - minPrice) / span) * (height - 80);
    return [x, y];
  });

  const linePoints = coords.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ');
  linePath.setAttribute('d', coords.length ? `M ${linePoints}` : '');
  areaPath.setAttribute('d', coords.length ? `M ${linePoints} L ${width} ${height} L 0 ${height} Z` : '');

  const lastY = coords.length ? coords[coords.length - 1][1] : height / 2;
  const currentLine = document.getElementById('chartCurrentLine');
  const labelBg = document.getElementById('chartCurrentLabelBg');
  const labelText = document.getElementById('chartCurrentLabelText');
  if (currentLine) { currentLine.setAttribute('y1', lastY.toFixed(1)); currentLine.setAttribute('y2', lastY.toFixed(1)); }
  if (labelBg) labelBg.setAttribute('y', (lastY - 8).toFixed(1));
  if (labelText) { labelText.setAttribute('y', (lastY + 4).toFixed(1)); labelText.textContent = formatPriceInSol(currentPrice); }
}
