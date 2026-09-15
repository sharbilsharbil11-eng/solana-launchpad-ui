/* ================================================================
   Velo — real Jupiter swaps (Solana mainnet, real money)
   ================================================================
   This is the one place in the whole app that touches real funds. Every
   other trading path (create/buy/sell against Velo's own bonding curve)
   runs on devnet with free test SOL, signed by the app's own auto-
   generated custodial wallet (see app.js/getOrCreateWallet). Jupiter only
   has liquidity on mainnet, so buying a Market-tab token means real SOL —
   which is why this deliberately does NOT reuse that custodial wallet.
   Instead it connects to the visitor's own external wallet extension
   (Phantom/Solflare/Trust Wallet — same detection list app.js already
   uses for login) and every transaction is built here but signed by that
   extension, in the user's own UI, under their own control. Velo's code
   never sees or holds a real private key.

   Loaded on both index.html (for a possible future board-level entry
   point) and token.html — the actual buy/sell UI lives on token.html's
   trade panel now, wired up in token-page.js's initJupiterTokenPage,
   which appears whenever a mint isn't a Velo bonding-curve token but is
   a real token Jupiter knows about: same page, same Buy/Sell panel a
   Velo-native token uses, just backed by a real swap instead.

   Every real swap also routes a 1% platform commission to Velo, via
   Jupiter's own Referral Program (referral.jup.ag) — see the constants
   below. Jupiter deducts it directly from the swap's output amount; Velo
   never does a separate transfer.

   IMPORTANT — could not verify live: this sandbox has no network access
   to Jupiter's API (see jupiter.js's own note), so the Quote/Swap API
   request and response shapes below are best-effort from Jupiter's
   documented Swap API v1, not confirmed against a live call. Get one real
   test swap in before trusting this with meaningful amounts — including
   confirming the 1% fee actually lands on the referral dashboard.
   ================================================================ */

const SOLANA_MAINNET_RPC_ENDPOINT = 'https://api.mainnet-beta.solana.com';
const JUPITER_SWAP_API = 'https://lite-api.jup.ag/swap/v1';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const DEFAULT_SWAP_SLIPPAGE_BPS = 100; // 1% — real slippage on a real trade, not the free-test-SOL tolerance used elsewhere

// ── Velo's commission on real Jupiter swaps ──
// Set up by the user via Jupiter's own Referral Dashboard (referral.jup.ag) —
// not something Velo's code creates. Every real buy/sell routed through
// Jupiter sends this cut to that account automatically, taken out of the
// output side of the swap by Jupiter itself (never a separate transfer).
// PDA derivation could not be verified against a live call in this sandbox
// (no network access to Jupiter/Solana here) — it follows Jupiter's
// documented Referral Program convention. Confirm the fee actually lands
// on the referral dashboard after one real test trade before relying on it.
const JUPITER_REFERRAL_PROGRAM_ID = 'REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3';
const JUPITER_REFERRAL_ACCOUNT = '5vzXuVQwgjNEG75tbVSCAxZN9RGp4q1HA9AH2j6Pi5rb';
const PLATFORM_FEE_BPS = 100; // 1%

// Each mint Velo collects fees in needs its own Referral Token Account —
// a PDA under the Referral Program, unique per (referral account, mint).
function getReferralFeeAccount(mint) {
  const [pda] = solanaWeb3.PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('referral_ata'), new solanaWeb3.PublicKey(JUPITER_REFERRAL_ACCOUNT).toBuffer(), new solanaWeb3.PublicKey(mint).toBuffer()],
    new solanaWeb3.PublicKey(JUPITER_REFERRAL_PROGRAM_ID)
  );
  return pda.toBase58();
}

let veloMainnetWallet = null; // { provider: string, instance, publicKey: string } | null, once connected

function shortenMainnetAddress(addr) {
  return addr ? addr.slice(0, 4) + '...' + addr.slice(-4) : '';
}

// ── Connect flow — a small dedicated picker, separate from the login
// modal's wallet option (that one only proves ownership with a signed
// message; this one is used to actually sign and send real transactions).
function buildMainnetWalletOverlay() {
  if (document.getElementById('mainnetWalletOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'mainnetWalletOverlay';
  overlay.className = 'verify-modal-overlay';
  overlay.innerHTML = `
    <div class="verify-modal" role="dialog" aria-modal="true" aria-labelledby="mainnetWalletTitle">
      <button class="verify-modal-close" id="mainnetWalletClose" aria-label="Close">&times;</button>
      <h2 class="verify-modal-title" id="mainnetWalletTitle">Connect a wallet to trade</h2>
      <p class="form-hint" style="margin:4px 0 16px;">⚠️ This connects a <strong>real Solana mainnet</strong> wallet with real SOL — separate from your free Velo devnet wallet. Every swap must be approved by you, in your wallet extension, every time.</p>
      <div class="wallet-picker-list" id="mainnetWalletList"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('mainnetWalletClose').addEventListener('click', closeMainnetWalletPicker);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMainnetWalletPicker(); });
}

function renderMainnetWalletList() {
  const list = document.getElementById('mainnetWalletList');
  if (!list) return;
  list.innerHTML = EXTERNAL_WALLET_PROVIDERS.map((p) => {
    const detected = !!p.get();
    return `
      <button class="wallet-picker-option" data-wallet-id="${p.id}">
        <span class="wallet-picker-icon">${p.icon}</span>
        <span class="wallet-picker-name">${p.name}</span>
        <span class="wallet-picker-status">${detected ? 'Detected' : 'Not installed'}</span>
      </button>
    `;
  }).join('');
  list.querySelectorAll('.wallet-picker-option').forEach((btn) => {
    btn.addEventListener('click', () => handleMainnetWalletSelect(btn.dataset.walletId, btn));
  });
}

function openMainnetWalletPicker() {
  buildMainnetWalletOverlay();
  renderMainnetWalletList();
  document.getElementById('mainnetWalletOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMainnetWalletPicker() {
  const overlay = document.getElementById('mainnetWalletOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

async function handleMainnetWalletSelect(walletId, btnEl) {
  const provider = EXTERNAL_WALLET_PROVIDERS.find((p) => p.id === walletId);
  if (!provider) return;
  const instance = provider.get();
  if (!instance) { window.open(provider.installUrl, '_blank'); return; }

  const original = btnEl.innerHTML;
  btnEl.disabled = true;
  btnEl.querySelector('.wallet-picker-status').textContent = 'Connecting…';
  try {
    const resp = await instance.connect();
    const publicKey = (resp?.publicKey || instance.publicKey)?.toString();
    if (!publicKey) throw new Error('Wallet did not return a public key.');
    veloMainnetWallet = { provider: provider.name, instance, publicKey };
    closeMainnetWalletPicker();
    updateMarketWalletUI();
  } catch (err) {
    console.error(`${provider.name} connection failed:`, err);
    btnEl.disabled = false;
    btnEl.innerHTML = original;
    alert(`Could not connect ${provider.name}: ${err?.message || 'unknown error'}`);
  }
}

function disconnectMainnetWallet() {
  veloMainnetWallet = null;
  updateMarketWalletUI();
}

// Refreshes the connect/connected banner and every card's buy control —
// called after connecting/disconnecting so the whole Market tab reflects
// the current wallet state without a full re-render.
function updateMarketWalletUI() {
  const banner = document.getElementById('marketWalletBanner');
  if (banner) {
    banner.innerHTML = veloMainnetWallet
      ? `<span>🟢 Connected: <strong>${veloMainnetWallet.provider}</strong> (${shortenMainnetAddress(veloMainnetWallet.publicKey)})</span>
         <button type="button" class="btn btn-outline btn-sm" onclick="disconnectMainnetWallet()">Disconnect</button>`
      : `<span>🔴 Connect a real wallet to buy these tokens — Solana mainnet, real SOL.</span>
         <button type="button" class="btn btn-outline btn-sm" onclick="openMainnetWalletPicker()">Connect Wallet</button>`;
  }
  document.querySelectorAll('.market-buy-btn').forEach((btn) => {
    btn.disabled = !veloMainnetWallet;
    btn.title = veloMainnetWallet ? '' : 'Connect a wallet above first';
  });
  // token.html's single Buy/Sell button, when viewing a Jupiter-sourced
  // (non-Velo) token — see token-page.js's initJupiterTokenPage, which
  // marks it with data-jupiter-mode so this doesn't touch the button on
  // an ordinary Velo bonding-curve token page.
  const tradeBtn = document.getElementById('tradeBtn');
  if (tradeBtn && tradeBtn.dataset.jupiterMode === '1') {
    tradeBtn.disabled = !veloMainnetWallet;
    tradeBtn.title = veloMainnetWallet ? '' : 'Connect a wallet above first';
  }
}

// ── Quote + swap, via Jupiter's Swap API v1 ──
async function fetchJupiterQuote({ inputMint, outputMint, amountLamports, slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS, platformFeeBps = 0 }) {
  let url = `${JUPITER_SWAP_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`;
  if (platformFeeBps > 0) url += `&platformFeeBps=${platformFeeBps}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Jupiter quote failed (${resp.status})`);
  const quote = await resp.json();
  if (!quote || !quote.outAmount) throw new Error('Jupiter returned no route for this trade.');
  return quote;
}

async function buildJupiterSwapTransaction({ quoteResponse, userPublicKey, feeAccount = null }) {
  const body = { quoteResponse, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true };
  if (feeAccount) body.feeAccount = feeAccount;
  const resp = await fetch(`${JUPITER_SWAP_API}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Jupiter swap build failed (${resp.status})`);
  const data = await resp.json();
  if (!data.swapTransaction) throw new Error('Jupiter did not return a transaction to sign.');
  return data.swapTransaction; // base64-encoded VersionedTransaction
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Signs (and sends, if the wallet supports doing both in one call) a
// Jupiter-built VersionedTransaction with the connected external wallet —
// never Velo's own custodial devnet wallet. Shared by buy and sell below.
async function signAndSendWithMainnetWallet(swapTxB64) {
  const tx = solanaWeb3.VersionedTransaction.deserialize(base64ToBytes(swapTxB64));
  const instance = veloMainnetWallet.instance;
  if (typeof instance.signAndSendTransaction === 'function') {
    const result = await instance.signAndSendTransaction(tx);
    return result?.signature || result;
  }
  if (typeof instance.signTransaction === 'function') {
    const signedTx = await instance.signTransaction(tx);
    const connection = new solanaWeb3.Connection(SOLANA_MAINNET_RPC_ENDPOINT, 'confirmed');
    return connection.sendRawTransaction(signedTx.serialize());
  }
  throw new Error('This connected wallet does not support signing transactions.');
}

async function executeJupiterSwap({ inputMint, outputMint, amountRaw, slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS }) {
  if (!veloMainnetWallet) throw new Error('Connect a wallet first.');
  if (!(amountRaw > 0)) throw new Error('Enter an amount greater than 0.');

  // Commission is taken out of the output side of the swap, so the fee
  // account must be a Referral Token Account for the output mint — if the
  // PDA can't be derived for some reason, fall back to a fee-free swap
  // rather than blocking the user's trade entirely.
  let feeAccount = null;
  try { feeAccount = getReferralFeeAccount(outputMint); } catch (err) { console.warn('Could not derive Jupiter referral fee account, proceeding without a platform fee:', err); }
  const platformFeeBps = feeAccount ? PLATFORM_FEE_BPS : 0;

  const quote = await fetchJupiterQuote({ inputMint, outputMint, amountLamports: amountRaw, slippageBps, platformFeeBps });
  const swapTxB64 = await buildJupiterSwapTransaction({ quoteResponse: quote, userPublicKey: veloMainnetWallet.publicKey, feeAccount });
  const signature = await signAndSendWithMainnetWallet(swapTxB64);
  return { signature, quote };
}

// Real SOL -> outputMint swap. Returns { signature, quote }.
async function executeJupiterBuy({ outputMint, solAmount, slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS }) {
  const amountLamports = Math.round(Number(solAmount) * solanaWeb3.LAMPORTS_PER_SOL);
  return executeJupiterSwap({ inputMint: WSOL_MINT, outputMint, amountRaw: amountLamports, slippageBps });
}

// Real inputMint -> SOL swap (selling a token you hold in the connected
// wallet). `decimals` is that token's own decimals (from Jupiter's token
// data), needed to convert the human amount into raw base units. Returns
// { signature, quote }.
async function executeJupiterSell({ inputMint, tokenAmount, decimals, slippageBps = DEFAULT_SWAP_SLIPPAGE_BPS }) {
  const amountRaw = Math.round(Number(tokenAmount) * 10 ** decimals);
  return executeJupiterSwap({ inputMint, outputMint: WSOL_MINT, amountRaw, slippageBps });
}
