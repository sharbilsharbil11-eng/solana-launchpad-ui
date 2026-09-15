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
    // Not a Velo bonding-curve token — before giving up, check whether
    // it's a real token tradeable on the wider market via Jupiter. Same
    // page either way; see initJupiterTokenPage for what differs.
    let jupiterToken = null;
    try {
      jupiterToken = await fetchJupiterTokenByMint(mintStr);
    } catch (err) {
      console.error('Jupiter lookup failed:', err);
    }
    if (jupiterToken) {
      initJupiterTokenPage(mintPubkey, jupiterToken);
      return;
    }
    showTokenLoadError('This token wasn\'t found on Velo or on the wider Solana market — check the address.');
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
  loadCreatorFeeIdentity(connection, mintPubkey);
}

// Shows who the fee splitter's first recipient actually pays — either this
// token's creator wallet, or a linked X handle (self-declared at creation,
// not verified — see the note on the Create page). Real on-chain read
// either way, not inferred from localStorage. (Today create.html always
// writes a single-recipient splitter, so index 0 is the whole picture; a
// multi-recipient creation UI would need to render the rest of the array.)
async function loadCreatorFeeIdentity(connection, mintPubkey) {
  const el = document.getElementById('infoCreator');
  if (!el) return;
  let splitter;
  try {
    splitter = await fetchFeeSplitter(connection, mintPubkey);
  } catch (err) {
    console.error('Failed to load fee splitter:', err);
    return;
  }
  if (!splitter || splitter.recipientCount === 0) return;
  const entry = splitter.recipients[0];
  if (entry.creatorType === 'wallet' && entry.identityPubkey) {
    el.textContent = shortenAddress(entry.identityPubkey.toBase58());
  } else if (entry.identityString) {
    el.innerHTML = `🐦 @${escapeHtml(entry.identityString)} <span style="color:var(--text-dim);font-weight:400;">(unverified)</span>`;
  }
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

  const starBtn = document.getElementById('favoriteStarBtn');
  if (starBtn) {
    starBtn.style.display = '';
    updateFavoriteStarUI(isFavoriteToken(mintStr));
  }

  applySocialLinks(meta);
}

// Wired to favoriteStarBtn's onclick — only active once applyTokenIdentity
// has revealed the button for a real (?mint=...) token, at which point
// veloRealToken.mint is already set.
function toggleFavoriteCurrentToken() {
  if (!veloRealToken || !veloRealToken.mint) return;
  updateFavoriteStarUI(toggleFavoriteToken(veloRealToken.mint));
}

function updateFavoriteStarUI(isFavorited) {
  const btn = document.getElementById('favoriteStarBtn');
  if (!btn) return;
  btn.textContent = isFavorited ? '★' : '☆';
  btn.classList.toggle('active', isFavorited);
  btn.title = isFavorited ? 'Remove from favorites' : 'Add to favorites';
}

// Only what the creator actually filled in on create.html shows up here —
// no placeholder "#" links to nowhere.
function normalizeUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
}

function applySocialLinks(meta) {
  const links = { socialTwitter: meta?.twitter, socialTelegram: meta?.telegram, socialWebsite: meta?.website, socialDiscord: meta?.discord };
  let anyVisible = false;
  Object.entries(links).forEach(([id, raw]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const url = normalizeUrl(raw);
    if (url) {
      el.href = url;
      // .btn sets display:inline-flex, which beats the [hidden] attribute's
      // UA-stylesheet display:none at equal specificity — set display
      // directly rather than relying on `hidden`.
      el.style.display = '';
      anyVisible = true;
    } else {
      el.style.display = 'none';
    }
  });
  const card = document.getElementById('socialLinksCard');
  if (card) card.hidden = !anyVisible;
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

// A mint that isn't a Velo bonding-curve token, but is a real token
// Jupiter knows about — same page as a Velo-native token (chart, Buy/Sell
// panel, Token Info), just backed by real Jupiter market data and, when
// trading, a real mainnet swap instead of Velo's own program. See
// jupiter.js (data) and jupiter-trade.js (the actual swap + wallet
// connect this wires the trade button to).
function initJupiterTokenPage(mintPubkey, jt) {
  veloRealToken.jupiter = jt;

  const nameEl = document.getElementById('chartTokenName');
  if (nameEl) {
    nameEl.innerHTML = escapeHtml(jt.name || jt.symbol || shortenAddress(jt.mint)) + (jt.symbol ? ` <span class="chart-token-ticker">${escapeHtml(jt.symbol)}</span>` : '');
  }
  document.title = (jt.symbol ? '$' + jt.symbol : (jt.name || shortenAddress(jt.mint))) + ' — Velo';
  const imgEl = document.getElementById('chartTokenImg');
  if (imgEl) {
    if (jt.icon) {
      imgEl.innerHTML = `<img src="${escapeHtml(jt.icon)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.parentElement.textContent='🪙';">`;
    } else {
      imgEl.textContent = '🪙';
    }
  }

  const starBtn = document.getElementById('favoriteStarBtn');
  if (starBtn) { starBtn.style.display = ''; updateFavoriteStarUI(isFavoriteToken(jt.mint)); }

  const priceEl = document.getElementById('chartTokenPrice');
  if (priceEl) { priceEl.textContent = formatUsd(jt.priceUsd); priceEl.style.color = ''; }

  setText('infoMarketCap', formatUsd(jt.marketCapUsd));
  setText('infoVolume', jt.liquidityUsd ? formatUsd(jt.liquidityUsd) : '—');
  setText('infoVolumeLabel', 'Liquidity');
  setText('infoLiquidity', jt.liquidityUsd ? formatUsd(jt.liquidityUsd) : '—');
  setText('infoSupply', jt.totalSupply ? formatWholeTokens(jt.totalSupply) : '—');
  setText('infoHolders', '—'); // not available from Jupiter's token API — honestly omitted, not guessed
  setText('infoCreator', '—'); // not a Velo token — no creator to attribute here
  const statusEl = document.getElementById('infoStatus');
  if (statusEl) { statusEl.textContent = '🪐 Live on Jupiter'; statusEl.className = 'token-info-val'; }

  // No bonding curve for a token that already trades on the open market —
  // hide the progress block rather than show a meaningless percentage.
  const progressBlock = document.getElementById('infoProgressBlock');
  if (progressBlock) progressBlock.style.display = 'none';

  // No real historical trade data for this mint (it isn't traded through
  // Velo's own program) — render the same "flat, current price" fallback
  // a brand-new Velo token with zero trades yet already uses, rather than
  // fabricating a history.
  renderChart([], jt.priceUsd);

  // Trades/Holders tabs are Velo-program-specific (reconstructed from
  // real transactions against Velo's bonding curve) — don't apply here.
  const tradesBody = document.getElementById('tradesTableBody');
  if (tradesBody) tradesBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px 0;">Trade history isn't available here for a token outside Velo's own program — <a href="https://solscan.io/token/${jt.mint}" target="_blank" rel="noopener" style="color:var(--green);">view on Solscan</a>.</td></tr>`;
  const holderList = document.getElementById('holderList');
  if (holderList) holderList.innerHTML = `<p style="color:var(--text-muted);padding:16px 0;text-align:center;">Holder data isn't available here for a token outside Velo's own program — <a href="https://solscan.io/token/${jt.mint}" target="_blank" rel="noopener" style="color:var(--green);">view on Solscan</a>.</p>`;

  wireJupiterTradeButton(jt);
}

// Wires the same Buy/Sell panel a Velo-native token uses to a real
// Jupiter swap instead — connect an external mainnet wallet (never
// Velo's own custodial devnet wallet), confirm the exact real-money
// amount every time, then sign in that wallet's own UI.
function wireJupiterTradeButton(jt) {
  const btn = document.getElementById('tradeBtn');
  const amountInput = document.getElementById('tradeAmountInput');
  if (!btn || !amountInput) return;

  btn.dataset.jupiterMode = '1';
  const banner = document.getElementById('marketWalletBanner');
  if (banner) banner.style.display = '';
  updateMarketWalletUI();

  btn.onclick = async () => {
    if (!veloMainnetWallet) { openMainnetWalletPicker(); return; }

    const amount = parseFloat(amountInput.value);
    const mode = btn.dataset.mode || 'buy';
    if (!amount || amount <= 0) { showTradeStatus('Enter an amount first.', 'var(--red)'); return; }

    const tokenLabel = jt.name || jt.symbol || shortenAddress(jt.mint);
    const confirmMsg = mode === 'buy'
      ? `Buy ${tokenLabel} with ${amount} SOL?\n\nThis is a REAL trade on Solana MAINNET using REAL SOL from your connected wallet (${veloMainnetWallet.provider}). Velo takes a 1% platform fee on this trade. This is not test money and cannot be undone.`
      : `Sell ${amount} ${jt.symbol || tokenLabel} for SOL?\n\nThis is a REAL trade on Solana MAINNET from your connected wallet (${veloMainnetWallet.provider}). Velo takes a 1% platform fee on this trade. This is not test money and cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = mode === 'buy' ? 'Buying…' : 'Selling…';
    showTradeStatus('Sending your swap — approve it in your wallet…', 'var(--text-secondary)');

    try {
      const { signature } = mode === 'buy'
        ? await executeJupiterBuy({ outputMint: jt.mint, solAmount: amount })
        : await executeJupiterSell({ inputMint: jt.mint, tokenAmount: amount, decimals: jt.decimals });

      const statusEl = document.getElementById('tradeStatus');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--green)';
        statusEl.innerHTML = `✅ Sent — <a href="https://solscan.io/tx/${signature}" target="_blank" rel="noopener" style="color:var(--green);text-decoration:underline;">view on Solscan</a>`;
      }
      amountInput.value = '';
    } catch (err) {
      console.error('Jupiter swap failed:', err);
      showTradeStatus('Failed: ' + (err && err.message ? err.message : 'Unknown error.'), 'var(--red)');
    } finally {
      btn.disabled = !veloMainnetWallet;
      btn.textContent = originalText;
    }
  };
}

// Buying spends SOL, selling spends the token itself — keep the amount
// input's unit label honest about which one is being entered.
function onTradeModeChanged(mode) {
  const label = document.getElementById('tradeInputSuffixLabel');
  if (!label) return;
  if (mode === 'buy') {
    label.textContent = 'SOL';
  } else {
    const ticker = (veloRealToken && loadTokenMeta(veloRealToken.mint)?.ticker) || veloRealToken?.jupiter?.symbol || 'TOKEN';
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

/* ================================================================
   Generic swap mode — token.html with no ?mint= (e.g. the nav bar's
   "Trade" link). There's no single token to show a page for, so this
   turns the trade card into a real token-to-token swap instead: pick
   any two Solana tokens, get a live Jupiter quote, swap for real via a
   connected external wallet. Same real-money rules as the single-token
   Jupiter flow above: explicit confirm() every time, Velo's 1% fee
   applies automatically (see executeJupiterSwap in jupiter-trade.js).
   ================================================================ */
let veloSwapState = { from: null, to: null, pickerTarget: null };
let veloSwapQuoteTimer = null;
let veloSwapQuoteSeq = 0;

function initGenericSwapPage() {
  document.title = 'Swap — Velo';
  veloSwapState = { from: SOL_PSEUDO_TOKEN, to: null, pickerTarget: null };

  const leftCol = document.getElementById('tokenLeftColumn');
  if (leftCol) leftCol.style.display = 'none';
  const infoCard = document.getElementById('tokenInfoCard');
  if (infoCard) infoCard.style.display = 'none';
  const socialCard = document.getElementById('socialLinksCard');
  if (socialCard) socialCard.style.display = 'none';

  document.getElementById('genericSwapPicker').style.display = '';
  document.getElementById('tradeToggleRow').style.display = 'none';
  document.getElementById('tradeAmountGroup').style.display = 'none';
  document.getElementById('tradeQuickAmounts').style.display = 'none';
  document.getElementById('tradeSlippageRow').style.display = 'none';

  const banner = document.getElementById('marketWalletBanner');
  if (banner) banner.style.display = '';
  updateMarketWalletUI();

  updateSwapTokenButton('from');
  updateSwapTokenButton('to');

  document.getElementById('swapFromTokenBtn').onclick = () => openSwapTokenPicker('from');
  document.getElementById('swapToTokenBtn').onclick = () => openSwapTokenPicker('to');
  document.getElementById('swapFlipBtn').onclick = swapFlipDirection;
  document.getElementById('swapFromAmount').addEventListener('input', () => {
    clearTimeout(veloSwapQuoteTimer);
    veloSwapQuoteTimer = setTimeout(refreshSwapQuote, 500);
  });

  document.getElementById('swapTokenPickerClose').onclick = closeSwapTokenPicker;
  document.getElementById('swapTokenPickerOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'swapTokenPickerOverlay') closeSwapTokenPicker();
  });
  let searchTimer = null;
  document.getElementById('swapTokenSearchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(() => runSwapTokenSearch(q), 400);
  });

  wireGenericSwapButton();
}

function updateSwapTokenButton(side) {
  const btn = document.getElementById(side === 'from' ? 'swapFromTokenBtn' : 'swapToTokenBtn');
  const token = veloSwapState[side];
  if (btn) btn.textContent = token ? (token.symbol || shortenAddress(token.mint)) : 'Select token';
}

function swapFlipDirection() {
  if (!veloSwapState.to) return; // nothing to flip to yet
  const tmp = veloSwapState.from;
  veloSwapState.from = veloSwapState.to;
  veloSwapState.to = tmp;
  updateSwapTokenButton('from');
  updateSwapTokenButton('to');
  document.getElementById('swapFromAmount').value = '';
  document.getElementById('swapToAmount').value = '';
  document.getElementById('swapQuoteHint').textContent = '';
}

function openSwapTokenPicker(side) {
  veloSwapState.pickerTarget = side;
  document.getElementById('swapTokenSearchInput').value = '';
  document.getElementById('swapTokenResults').innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">Loading popular tokens…</p>';
  document.getElementById('swapTokenPickerOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  fetchJupiterTrendingTokens({ limit: 15 })
    .then((tokens) => renderSwapTokenResults(tokens))
    .catch((err) => {
      console.error('Failed to load trending tokens:', err);
      document.getElementById('swapTokenResults').innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">Could not load tokens — try searching by name or mint address.</p>';
    });
}

function closeSwapTokenPicker() {
  document.getElementById('swapTokenPickerOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

async function runSwapTokenSearch(query) {
  const resultsEl = document.getElementById('swapTokenResults');
  if (!query || !query.trim()) {
    fetchJupiterTrendingTokens({ limit: 15 }).then(renderSwapTokenResults).catch(() => {});
    return;
  }
  resultsEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">Searching…</p>';
  try {
    const results = await searchJupiterTokens(query);
    renderSwapTokenResults(results);
  } catch (err) {
    console.error('Token search failed:', err);
    resultsEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">Search failed — try again.</p>';
  }
}

function renderSwapTokenResults(tokens) {
  const resultsEl = document.getElementById('swapTokenResults');
  const otherSide = veloSwapState.pickerTarget === 'from' ? 'to' : 'from';
  const otherMint = veloSwapState[otherSide]?.mint;
  const list = tokens.filter((t) => t.mint !== otherMint);
  if (!list.length) {
    resultsEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No matching tokens.</p>';
    return;
  }
  resultsEl.innerHTML = list.map((t) => `
    <button type="button" class="wallet-picker-option" data-mint="${escapeHtml(t.mint)}">
      <span class="wallet-picker-icon">${t.icon ? `<img src="${escapeHtml(t.icon)}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none';">` : '🪙'}</span>
      <span class="wallet-picker-name">${escapeHtml(t.name || t.symbol || shortenAddress(t.mint))} <span style="color:var(--text-muted);">${escapeHtml(t.symbol || '')}</span></span>
    </button>
  `).join('');
  resultsEl.querySelectorAll('[data-mint]').forEach((btn) => {
    const token = list.find((t) => t.mint === btn.dataset.mint);
    btn.addEventListener('click', () => selectSwapToken(token));
  });
}

function selectSwapToken(token) {
  veloSwapState[veloSwapState.pickerTarget] = token;
  updateSwapTokenButton(veloSwapState.pickerTarget);
  closeSwapTokenPicker();
  refreshSwapQuote();
}

async function refreshSwapQuote() {
  const hint = document.getElementById('swapQuoteHint');
  const toAmountEl = document.getElementById('swapToAmount');
  const { from, to } = veloSwapState;
  const amount = parseFloat(document.getElementById('swapFromAmount').value);

  if (!from || !to || !amount || amount <= 0) {
    toAmountEl.value = '';
    if (hint) hint.textContent = '';
    wireGenericSwapButton();
    return;
  }
  // Readiness (both tokens picked + a positive amount) doesn't depend on
  // the quote itself succeeding — enable the swap button right away rather
  // than leaving it disabled for the round-trip, or stuck disabled forever
  // if this call resolves after a newer one already replaced it below.
  wireGenericSwapButton();

  const seq = ++veloSwapQuoteSeq;
  if (hint) hint.textContent = 'Getting quote…';
  try {
    const amountRaw = Math.round(amount * 10 ** from.decimals);
    // Include the same platform fee the actual swap will apply, so the
    // estimate shown here matches what executeJupiterSwap will really send.
    const quote = await fetchJupiterQuote({ inputMint: from.mint, outputMint: to.mint, amountLamports: amountRaw, platformFeeBps: PLATFORM_FEE_BPS });
    if (seq !== veloSwapQuoteSeq) return; // a newer input superseded this quote
    const outAmount = Number(quote.outAmount) / 10 ** to.decimals;
    toAmountEl.value = outAmount.toLocaleString(undefined, { maximumFractionDigits: 8 });
    if (hint) hint.textContent = `1 ${from.symbol || 'token'} ≈ ${(outAmount / amount).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${to.symbol || 'token'}`;
  } catch (err) {
    if (seq !== veloSwapQuoteSeq) return;
    console.error('Swap quote failed:', err);
    toAmountEl.value = '';
    if (hint) { hint.textContent = 'No route found for this pair right now.'; hint.style.color = 'var(--red)'; }
  }
}

function wireGenericSwapButton() {
  const btn = document.getElementById('tradeBtn');
  if (!btn) return;
  btn.className = 'trade-submit buy-btn';
  btn.dataset.jupiterMode = '1';
  btn.dataset.swapMode = 'generic';

  const { from, to } = veloSwapState;
  const amount = parseFloat(document.getElementById('swapFromAmount')?.value);
  const ready = from && to && amount > 0;

  if (!veloMainnetWallet) {
    btn.textContent = '🔌 Connect Wallet to Swap';
    btn.disabled = false;
    btn.onclick = () => openMainnetWalletPicker();
    return;
  }
  if (!ready) {
    btn.textContent = '🔀 Select tokens and an amount';
    btn.disabled = true;
    btn.onclick = null;
    return;
  }

  btn.textContent = '🔀 Swap';
  btn.disabled = false;
  btn.onclick = async () => {
    const amountNow = parseFloat(document.getElementById('swapFromAmount').value);
    if (!amountNow || amountNow <= 0) { showTradeStatus('Enter an amount first.', 'var(--red)'); return; }
    const estOut = document.getElementById('swapToAmount').value || '?';

    const confirmMsg = `Swap ${amountNow} ${from.symbol || shortenAddress(from.mint)} for approximately ${estOut} ${to.symbol || shortenAddress(to.mint)}?\n\nThis is a REAL trade on Solana MAINNET using REAL funds from your connected wallet (${veloMainnetWallet.provider}). Velo takes a 1% platform fee on this trade. This is not test money and cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Swapping…';
    showTradeStatus('Sending your swap — approve it in your wallet…', 'var(--text-secondary)');

    try {
      const amountRaw = Math.round(amountNow * 10 ** from.decimals);
      const { signature } = await executeJupiterSwap({ inputMint: from.mint, outputMint: to.mint, amountRaw });
      const statusEl = document.getElementById('tradeStatus');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--green)';
        statusEl.innerHTML = `✅ Sent — <a href="https://solscan.io/tx/${signature}" target="_blank" rel="noopener" style="color:var(--green);text-decoration:underline;">view on Solscan</a>`;
      }
      document.getElementById('swapFromAmount').value = '';
      document.getElementById('swapToAmount').value = '';
    } catch (err) {
      console.error('Swap failed:', err);
      showTradeStatus('Failed: ' + (err && err.message ? err.message : 'Unknown error.'), 'var(--red)');
    } finally {
      wireGenericSwapButton();
    }
  };
}
