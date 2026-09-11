/* ================================================================
   Velo — Mock Data & Interactions
   Token board/create/trade/profile UI runs on mock data.
   The wallet system below generates real Solana keypairs client-side.
   ================================================================ */

// ── Mock token data ──
const TOKEN_NAMES = [
  { name: 'PEPE2025', ticker: 'PEPE25', emoji: '🐸', color: '#6366f1,#a855f7', desc: 'The king of memes returns for 2025. Community-driven, no BS, just vibes.' },
  { name: 'DogWifHat2', ticker: 'WIF2', emoji: '🐕', color: '#f472b6,#a855f7', desc: 'He still has the hat. And this time, he brought friends.' },
  { name: 'SolCat', ticker: 'SCAT', emoji: '🐱', color: '#facc15,#fb923c', desc: 'Fastest cat on the Solana blockchain. Meow to the moon.' },
  { name: 'MoonBoy', ticker: 'MOON', emoji: '🌙', color: '#3b82f6,#06b6d4', desc: 'We\'re not stopping until we hit the moon. Then Mars.' },
  { name: 'WAGMI', ticker: 'WAGMI', emoji: '💎', color: '#22c55e,#16a34a', desc: 'We are all gonna make it. Diamond hands only.' },
  { name: 'BONK2', ticker: 'BONK2', emoji: '🔨', color: '#ef4444,#f97316', desc: 'BONK is back with a vengeance. Bonk bonk bonk.' },
  { name: 'GigaChad', ticker: 'CHAD', emoji: '🗿', color: '#8b5cf6,#6366f1', desc: 'For chads only. If you have to ask, you can\'t afford it.' },
  { name: 'Degen', ticker: 'DEGEN', emoji: '🎰', color: '#ec4899,#f43f5e', desc: 'Born to degen. Forced to wageslave. Trading is the way out.' },
  { name: 'CopiumMax', ticker: 'COPE', emoji: '😤', color: '#14b8a6,#06b6d4', desc: 'Maximum copium achieved. We hold because we believe.' },
  { name: 'BasedGod', ticker: 'BASED', emoji: '⚡', color: '#f59e0b,#ef4444', desc: 'The most based token on Solana. Lil B approves.' },
  { name: 'Fren', ticker: 'FREN', emoji: '🤝', color: '#84cc16,#22c55e', desc: 'Be a fren. Buy fren. Hold fren. Simple as.' },
  { name: 'NPC', ticker: 'NPC', emoji: '🤖', color: '#64748b,#475569', desc: 'We are all NPCs in a simulation. Might as well get rich.' },
  { name: 'HODL', ticker: 'HODL', emoji: '🫴', color: '#d946ef,#a855f7', desc: 'Never selling. Not now. Not ever. Holding until heat death of universe.' },
  { name: 'PUMP', ticker: 'PUMP', emoji: '🚀', color: '#7bff69,#00d4ff', desc: 'The token that pumps. That\'s it. That\'s the pitch.' },
  { name: 'ApeIn', ticker: 'APE', emoji: '🦍', color: '#b45309,#d97706', desc: 'Ape now, think later. Financial advice? Never heard of her.' },
  { name: 'Rugged', ticker: 'RUG', emoji: '🧹', color: '#dc2626,#991b1b', desc: 'We named it Rugged so you can\'t say we didn\'t warn you.' },
];
const CREATOR_NAMES = [
  'degen_420.sol', 'whale_hunter', 'solana_maxi', 'crypto_chad',
  'pepe_lord', 'ape_together', 'diamond_hands', 'moon_shot',
  'based_dev', 'anon_builder', 'giga_brain', 'pump_master',
];

const CREATOR_COLORS = [
  '#f472b6,#a855f7', '#facc15,#fb923c', '#3b82f6,#06b6d4',
  '#22c55e,#16a34a', '#ef4444,#f97316', '#8b5cf6,#6366f1',
];

// ── Helpers ──
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return (Math.random() * (max - min) + min).toFixed(2); }
function randItem(arr) { return arr[rand(0, arr.length - 1)]; }
function formatMcap(n) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(0) + 'K';
  return '$' + n;
}

// ── Generate ticker ──
function generateTicker() {
  const track = document.getElementById('tickerTrack');
  if (!track) return;
  const actions = ['bought', 'sold', 'created'];
  let html = '';
  for (let i = 0; i < 30; i++) {
    const token = randItem(TOKEN_NAMES);
    const creator = randItem(CREATOR_NAMES);
    const action = randItem(actions);
    const amount = randFloat(0.1, 20);
    const cls = action === 'bought' ? 'green' : action === 'sold' ? 'red' : 'gradient-text';
    html += `<div class="ticker-item">
      <div style="width:20px;height:20px;border-radius:50%;background:linear-gradient(135deg,${token.color});display:flex;align-items:center;justify-content:center;font-size:11px;">${token.emoji}</div>
      <span style="color:var(--text-muted)">${creator}</span>
      <span class="${cls}">${action}</span>
      ${action !== 'created' ? `<span>${amount} SOL of</span>` : ''}
      <span style="font-weight:600;">${token.name}</span>
      <span style="color:var(--text-dim)">${rand(1, 59)}s ago</span>
    </div>`;
  }
  // Duplicate for seamless scroll
  track.innerHTML = html + html;
}

// ── Generate token cards ──
function generateTokenGrid(count, gridId) {
  const grid = document.getElementById(gridId || 'tokenGrid');
  if (!grid) return;

  const shuffled = [...TOKEN_NAMES].sort(() => Math.random() - 0.5);
  const tokens = shuffled.slice(0, Math.min(count, shuffled.length));

  let html = '';
  tokens.forEach((t, i) => {
    const mcap = rand(5000, 900000);
    const progress = rand(5, 98);
    const change = rand(-30, 500);
    const replies = rand(2, 342);
    const creator = randItem(CREATOR_NAMES);
    const creatorColor = randItem(CREATOR_COLORS);
    const isKing = i === 0 && !gridId;
    const isNew = rand(0, 5) === 0;

    html += `<div class="token-card fade-in" style="animation-delay:${i * 50}ms" onclick="window.location='token.html'" data-token-name="${t.name.toLowerCase()}" data-token-ticker="${t.ticker.toLowerCase()}" data-token-creator="${creator.toLowerCase()}">
      ${isKing ? '<div class="token-card-badge king">👑 King</div>' : isNew ? '<div class="token-card-badge">✨ New</div>' : ''}
      <div style="width:100%;aspect-ratio:1;background:linear-gradient(135deg,${t.color});display:flex;align-items:center;justify-content:center;font-size:64px;">${t.emoji}</div>
      <div class="token-card-body">
        <div class="token-card-header">
          <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,${creatorColor});display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">👤</div>
          <span class="token-card-creator">${creator}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-dim);">${rand(1, 59)}m ago</span>
        </div>
        <div class="token-card-name">${t.name} <span class="token-card-ticker">${t.ticker}</span></div>
        <div class="token-card-desc">${t.desc}</div>
        <div class="bonding-progress">
          <div class="bonding-progress-header">
            <span>bonding curve</span>
            <span style="color:${progress > 80 ? 'var(--green)' : 'var(--text-secondary)'};">${progress}%</span>
          </div>
          <div class="bonding-progress-bar">
            <div class="bonding-progress-fill" style="width:${progress}%"></div>
          </div>
        </div>
        <div class="token-card-stats">
          <div class="token-stat">
            <span class="token-stat-label">mkt cap: </span>
            <span class="token-stat-value">${formatMcap(mcap)}</span>
          </div>
          <div class="token-stat">
            <span class="token-stat-label">replies: </span>
            <span class="token-stat-value">${replies}</span>
          </div>
          <div class="token-stat ${change >= 0 ? 'green' : 'red'}">
            ${change >= 0 ? '+' : ''}${change}%
          </div>
        </div>
      </div>
    </div>`;
  });

  grid.innerHTML += html;
}

function loadMoreTokens() {
  generateTokenGrid(8);
}

// ── Tab switching ──
function initTabs() {
  document.querySelectorAll('.tab-bar .tab').forEach(tab => {
    tab.addEventListener('click', function () {
      this.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      // In a real app this would filter/sort; here we just shuffle cards
      const grid = document.getElementById('tokenGrid');
      if (grid) {
        grid.innerHTML = '';
        generateTokenGrid(12);
      }
    });
  });
}

// ── Timeframe buttons ──
document.addEventListener('click', function (e) {
  if (e.target.classList.contains('chart-tf-btn')) {
    e.target.parentElement.querySelectorAll('.chart-tf-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
  }
});

// ── Search focus effect ──
document.querySelectorAll('.header-search input').forEach(input => {
  input.addEventListener('focus', () => input.parentElement.style.borderColor = 'var(--green)');
  input.addEventListener('blur', () => input.parentElement.style.borderColor = 'var(--border)');
});

// ── Token search: filters the board's token cards by name, ticker or
// creator handle. Only the board page (index.html) has a #tokenGrid to
// filter; on other pages the search box hands off to the board on Enter. ──
function applyTokenSearchFilter(query) {
  const grid = document.getElementById('tokenGrid');
  if (!grid) return;
  const q = query.trim().toLowerCase();
  const cards = grid.querySelectorAll('.token-card');
  let visibleCount = 0;
  cards.forEach((card) => {
    const matches = !q
      || (card.dataset.tokenName || '').includes(q)
      || (card.dataset.tokenTicker || '').includes(q)
      || (card.dataset.tokenCreator || '').includes(q);
    card.hidden = !matches;
    if (matches) visibleCount++;
  });
  const emptyState = document.getElementById('tokenSearchEmpty');
  if (emptyState) emptyState.hidden = !q || visibleCount > 0;
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  if (loadMoreWrap) loadMoreWrap.hidden = !!q;
}

document.querySelectorAll('.header-search input').forEach((input) => {
  input.addEventListener('input', () => applyTokenSearchFilter(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (document.getElementById('tokenGrid')) {
      e.preventDefault();
      applyTokenSearchFilter(input.value);
    } else if (input.value.trim()) {
      window.location.href = 'index.html?q=' + encodeURIComponent(input.value.trim());
    }
  });
});

// Board page: apply a ?q= search param from a cross-page search handoff.
(function initSearchFromQueryParam() {
  const grid = document.getElementById('tokenGrid');
  if (!grid) return;
  const q = new URLSearchParams(window.location.search).get('q');
  if (!q) return;
  document.querySelectorAll('.header-search input').forEach((input) => { input.value = q; });
  // Wait for generateTokenGrid()'s inline <script> call (runs after app.js
  // loads) to populate the cards before filtering.
  window.addEventListener('DOMContentLoaded', () => applyTokenSearchFilter(q));
  if (document.readyState !== 'loading') applyTokenSearchFilter(q);
})();

// ── Intersection observer for fade-in ──
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  // Observe cards as they're added
  const gridObserver = new MutationObserver((mutations) => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.classList && node.classList.contains('token-card')) {
          observer.observe(node);
        }
      });
    });
  });

  document.querySelectorAll('.token-grid').forEach(grid => {
    gridObserver.observe(grid, { childList: true });
  });
}
// ── Internal Solana Wallet ──
// No external wallet extension required. Each visitor gets a real
// ed25519 Solana keypair generated in-browser on first load and kept
// in localStorage, so the same wallet persists across visits.
const WALLET_STORAGE_KEY = 'velo_wallet_v1';
const SOLANA_RPC_ENDPOINT = 'https://api.devnet.solana.com';

let currentWallet = null;

function loadStoredWallet() {
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return solanaWeb3.Keypair.fromSecretKey(Uint8Array.from(data.secretKey));
  } catch (err) {
    console.error('Failed to load stored wallet:', err);
    return null;
  }
}

function saveWallet(keypair) {
  localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({
    secretKey: Array.from(keypair.secretKey),
    publicKey: keypair.publicKey.toBase58(),
    createdAt: Date.now(),
  }));
}

function getOrCreateWallet() {
  let keypair = loadStoredWallet();
  if (!keypair) {
    keypair = solanaWeb3.Keypair.generate();
    saveWallet(keypair);
  }
  return keypair;
}

function shortenAddress(address) {
  return address.slice(0, 4) + '...' + address.slice(-4);
}

async function fetchWalletBalance(publicKey) {
  try {
    const connection = new solanaWeb3.Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
    const lamports = await connection.getBalance(publicKey);
    return lamports / solanaWeb3.LAMPORTS_PER_SOL;
  } catch (err) {
    console.error('Failed to fetch wallet balance:', err);
    return null;
  }
}

function renderWalletAddress() {
  if (!currentWallet) return;
  const address = currentWallet.publicKey.toBase58();
  const shortEl = document.getElementById('walletAddressShort');
  const fullEl = document.getElementById('walletAddressFull');
  const secretEl = document.getElementById('walletSecretKey');
  const profileAddrEl = document.getElementById('profileWalletAddress');
  if (shortEl) shortEl.textContent = shortenAddress(address);
  if (fullEl) fullEl.textContent = address;
  if (secretEl) secretEl.textContent = JSON.stringify(Array.from(currentWallet.secretKey));
  if (profileAddrEl) profileAddrEl.textContent = address;
}

async function refreshWalletBalance() {
  if (!currentWallet) return;
  const chipEl = document.getElementById('walletBalanceChip');
  const panelEl = document.getElementById('walletBalanceValue');
  const profileEl = document.getElementById('profileWalletBalance');
  if (chipEl) chipEl.textContent = '…';
  if (panelEl) panelEl.textContent = 'Loading…';
  const sol = await fetchWalletBalance(currentWallet.publicKey);
  const short = sol === null ? '—' : `${sol.toFixed(2)} SOL`;
  const full = sol === null ? 'Unavailable — check connection' : `${sol.toFixed(4)} SOL`;
  if (chipEl) chipEl.textContent = short;
  if (panelEl) panelEl.textContent = full;
  if (profileEl) profileEl.textContent = short;
}

function toggleWalletPanel(e) {
  if (e) e.stopPropagation();
  const panel = document.getElementById('walletPanel');
  if (panel) panel.classList.toggle('open');
}

function toggleSecretReveal() {
  const box = document.getElementById('walletSecretBox');
  if (box) box.classList.toggle('open');
}

function copyWalletAddress() {
  if (!currentWallet) return;
  navigator.clipboard?.writeText(currentWallet.publicKey.toBase58());
}

function copyWalletSecret() {
  if (!currentWallet) return;
  navigator.clipboard?.writeText(JSON.stringify(Array.from(currentWallet.secretKey)));
}

// Close the wallet panel when clicking outside it
document.addEventListener('click', function (e) {
  const panel = document.getElementById('walletPanel');
  const btn = document.getElementById('walletBtn');
  if (panel && panel.classList.contains('open') && !panel.contains(e.target) && !(btn && btn.contains(e.target))) {
    panel.classList.remove('open');
  }
});

// Renders the header button as the wallet chip (address + balance, opens
// the wallet panel) — the logged-in state.
async function showLoggedInWalletButton() {
  const btn = document.getElementById('walletBtn');
  if (!btn || !currentWallet) return;
  btn.onclick = toggleWalletPanel;
  btn.innerHTML = `
    <span class="live-dot" style="width:6px;height:6px;"></span>
    <span id="walletAddressShort"></span>
    <span class="wallet-balance-chip" id="walletBalanceChip"></span>
  `;
  renderWalletAddress();
  await refreshWalletBalance();
}

// Renders the header button as a plain "Log in" button that opens the
// verify modal — the logged-out state. The wallet panel (backup key,
// log out) stays inert/hidden until the visitor actually logs in.
function showLoggedOutWalletButton() {
  const btn = document.getElementById('walletBtn');
  if (!btn) return;
  btn.onclick = function (e) { if (e) e.stopPropagation(); openVerifyModal('nav'); };
  btn.innerHTML = '<span class="wallet-login-label">Log in</span>';
  const panel = document.getElementById('walletPanel');
  if (panel) panel.classList.remove('open');
}

async function applyWalletButtonSessionState(session) {
  if (session && session.loggedIn) {
    await showLoggedInWalletButton();
  } else {
    showLoggedOutWalletButton();
  }
}

async function initWallet() {
  const btn = document.getElementById('walletBtn');
  if (!btn) return;
  if (typeof solanaWeb3 === 'undefined') {
    console.error('Solana web3 library failed to load — wallet generation unavailable.');
    const profileAddrEl = document.getElementById('profileWalletAddress');
    const profileBalEl = document.getElementById('profileWalletBalance');
    if (profileAddrEl) profileAddrEl.textContent = 'Wallet unavailable — check connection';
    if (profileBalEl) profileBalEl.textContent = '—';
    btn.disabled = true;
    btn.innerHTML = '<span>Wallet unavailable</span>';
    return;
  }
  try {
    currentWallet = getOrCreateWallet();
  } catch (err) {
    console.error('Wallet init failed:', err);
    return;
  }
  try {
    const session = await getSession();
    await applyWalletButtonSessionState(session);
  } catch (err) {
    console.error('Session check failed during wallet init:', err);
    showLoggedOutWalletButton();
  }
}

// ── Profile verification modal ──
// Gates the Profile tab behind a real account system backed by the /api
// routes + Postgres: GitHub and Google are real OAuth, Wallet is a real
// signed-message proof of ownership. X/TikTok/Kick/Email don't have a
// registered OAuth app yet, so they go through a clearly-labeled
// placeholder endpoint that still creates a real server session (see
// api/auth/mock/callback.js) rather than a fake client-side flag.
let verifyModalContext = 'nav';
let veloSessionPromise = null;
let veloSessionCache = { loggedIn: false, user: null };

function getSession(forceRefresh) {
  if (forceRefresh) veloSessionPromise = null;
  if (!veloSessionPromise) {
    veloSessionPromise = fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => { veloSessionCache = data; return data; })
      .catch((err) => { console.error('Session check failed:', err); return { loggedIn: false, user: null }; });
  }
  return veloSessionPromise;
}

const EXTERNAL_WALLET_PROVIDERS = [
  {
    id: 'phantom',
    name: 'Phantom',
    icon: '👻',
    installUrl: 'https://phantom.app/',
    get: () => (window.phantom?.solana?.isPhantom && window.phantom.solana) || (window.solana?.isPhantom && window.solana) || null,
  },
  {
    id: 'solflare',
    name: 'Solflare',
    icon: '🔆',
    installUrl: 'https://solflare.com/',
    get: () => (window.solflare?.isSolflare && window.solflare) || null,
  },
  {
    id: 'trust',
    name: 'Trust Wallet',
    icon: '🛡️',
    installUrl: 'https://trustwallet.com/',
    get: () => window.trustwallet?.solana || null,
  },
];

// Connects to one specific wallet provider's injected instance and signs a
// proof-of-ownership message (Sign-In with Solana style). The backend
// verifies this signature server-side before trusting the address.
async function connectToProvider(provider) {
  const instance = provider.get();
  if (!instance) return null;
  try {
    const resp = await instance.connect();
    const address = (resp?.publicKey || instance.publicKey)?.toString();
    if (!address) throw new Error('Wallet did not return a public key');
    if (typeof instance.signMessage !== 'function') {
      console.error('This wallet does not support signMessage, so ownership cannot be verified.');
      return null;
    }
    const message = `Sign in to Velo\nAddress: ${address}\nTimestamp: ${Date.now()}`;
    const signed = await instance.signMessage(new TextEncoder().encode(message), 'utf8');
    const sigBytes = signed?.signature || signed;
    return { address, provider: provider.name, message, signature: Array.from(sigBytes) };
  } catch (err) {
    console.error(`${provider.name} connection failed:`, err);
    return null;
  }
}

function buildVerifyModal() {
  if (document.getElementById('verifyModalOverlay')) return;

  const walletIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><circle cx="18" cy="16" r="1"/></svg>`;

  const overlay = document.createElement('div');
  overlay.className = 'verify-modal-overlay';
  overlay.id = 'verifyModalOverlay';
  overlay.innerHTML = `
    <div class="verify-modal" role="dialog" aria-modal="true" aria-labelledby="verifyModalTitle">
      <button class="verify-modal-close" id="verifyModalClose" aria-label="Close">&times;</button>

      <div id="verifyMainView">
        <h2 class="verify-modal-title" id="verifyModalTitle">Welcome to Velo</h2>
        <p class="verify-modal-subtitle">Verify your profile to log in</p>

        <button class="verify-option" data-method="x">
          <span class="verify-option-icon">𝕏</span> Verify with X
        </button>

        <button class="verify-options-toggle" id="verifyOptionsToggle">Hide options <span class="chev">⌃</span></button>

        <div class="verify-options-list" id="verifyOptionsList">
          <button class="verify-option" data-method="tiktok"><span class="verify-option-icon">🎵</span> Verify with TikTok</button>
          <button class="verify-option" data-method="kick"><span class="verify-option-icon">⚡</span> Verify with Kick</button>
          <button class="verify-option" data-method="github"><span class="verify-option-icon">🐙</span> Verify with GitHub</button>
          <button class="verify-option" data-method="google"><span class="verify-option-icon" style="color:#4285F4;font-weight:800;">G</span> Verify with Google</button>
          <button class="verify-option" data-method="email"><span class="verify-option-icon">✉️</span> Verify with Email</button>
          <button class="verify-option" data-method="wallet"><span class="verify-option-icon">${walletIcon}</span> Verify with Wallet</button>
        </div>
      </div>

      <div id="walletPickerView" hidden>
        <button class="wallet-picker-back" id="walletPickerBack">← Back</button>
        <h2 class="verify-modal-title">Connect a wallet on Solana to continue</h2>
        <div class="wallet-picker-list" id="walletPickerList"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeVerifyModal(); });
  document.getElementById('verifyModalClose').addEventListener('click', closeVerifyModal);
  document.getElementById('walletPickerBack').addEventListener('click', closeWalletPicker);
  document.getElementById('verifyOptionsToggle').addEventListener('click', function () {
    const list = document.getElementById('verifyOptionsList');
    const collapsed = list.classList.toggle('collapsed');
    this.innerHTML = collapsed ? 'Show more options <span class="chev">⌄</span>' : 'Hide options <span class="chev">⌃</span>';
  });
  overlay.querySelectorAll('.verify-option').forEach((btn) => {
    btn.addEventListener('click', () => handleVerify(btn.dataset.method, btn));
  });
}

// Swaps the modal from the login-method list to the per-wallet picker
// ("Connect a wallet on Solana to continue"), re-detecting each provider
// fresh so the Detected/Not installed status is always accurate.
function renderWalletPickerList() {
  const list = document.getElementById('walletPickerList');
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
    btn.addEventListener('click', () => handleWalletPickerSelect(btn.dataset.walletId, btn));
  });
}

function openWalletPicker() {
  renderWalletPickerList();
  document.getElementById('verifyMainView').hidden = true;
  document.getElementById('walletPickerView').hidden = false;
}

function closeWalletPicker() {
  const pickerView = document.getElementById('walletPickerView');
  const mainView = document.getElementById('verifyMainView');
  if (pickerView) pickerView.hidden = true;
  if (mainView) mainView.hidden = false;
}

async function handleWalletPickerSelect(walletId, btnEl) {
  const provider = EXTERNAL_WALLET_PROVIDERS.find((p) => p.id === walletId);
  if (!provider) return;
  if (!provider.get()) {
    window.open(provider.installUrl, '_blank');
    return;
  }
  const originalHTML = btnEl.innerHTML;
  const statusEl = btnEl.querySelector('.wallet-picker-status');
  btnEl.disabled = true;
  if (statusEl) statusEl.textContent = 'Connecting…';
  const result = await connectToProvider(provider);
  if (!result) {
    btnEl.disabled = false;
    btnEl.innerHTML = originalHTML;
    return;
  }
  if (statusEl) statusEl.textContent = 'Verifying…';
  await finishWalletVerification(result, btnEl, originalHTML);
}

// Sends the signed proof-of-ownership message to the backend, which verifies
// the ed25519 signature server-side before trusting the address, then logs
// the visitor in.
async function finishWalletVerification(result, btnEl, originalLabel) {
  try {
    const resp = await fetch('/api/wallet/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ address: result.address, message: result.message, signature: result.signature }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || 'link_failed');
  } catch (err) {
    console.error('Wallet verification failed:', err);
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = originalLabel; }
    alert('Could not verify wallet ownership on the server. Please try again.');
    return;
  }
  getSession(true);
  const overlay = document.getElementById('verifyModalOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  window.location.href = 'profile.html';
}

function openVerifyModal(context) {
  verifyModalContext = context || 'nav';
  buildVerifyModal();
  closeWalletPicker();
  document.getElementById('verifyModalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeVerifyModal() {
  const overlay = document.getElementById('verifyModalOverlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
  // Landed on profile.html directly while unverified and backed out — nothing to show there.
  if (verifyModalContext === 'direct' && !veloSessionCache.loggedIn) {
    window.location.href = 'index.html';
  }
}

const REAL_OAUTH_START_URLS = {
  google: '/api/auth/google/start',
  github: '/api/auth/github/start',
};

async function handleVerify(method, btnEl) {
  if (method === 'wallet') {
    openWalletPicker();
    return;
  }

  if (REAL_OAUTH_START_URLS[method]) {
    window.location.href = REAL_OAUTH_START_URLS[method];
    return;
  }

  // X, TikTok, Kick, Email — no registered OAuth app yet (see api/auth/mock/callback.js).
  window.location.href = '/api/auth/mock/callback?method=' + encodeURIComponent(method);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeVerifyModal();
});

function renderProfileIdentity(user) {
  const nameEl = document.getElementById('profileIdentityName');
  if (!nameEl || !user) return;
  if (user.name) nameEl.textContent = user.name;
  else if (user.walletAddress) nameEl.textContent = shortenAddress(user.walletAddress);
}

function initProfileGate() {
  const onProfilePage = /profile\.html$/.test(location.pathname);

  document.querySelectorAll('a[href="profile.html"]').forEach((link) => {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      getSession().then((session) => {
        if (session.loggedIn) {
          window.location.href = 'profile.html';
        } else {
          openVerifyModal('nav');
        }
      });
    });
  });

  getSession().then((session) => {
    if (!onProfilePage) return;
    if (!session.loggedIn) {
      openVerifyModal('direct');
    } else {
      renderProfileIdentity(session.user);
    }
  });
}

initProfileGate();
initWallet();

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (err) { /* ignore */ }
  veloSessionPromise = null;
  veloSessionCache = { loggedIn: false, user: null };
  // Clean up the older localStorage-only flags from before the real backend existed.
  try {
    localStorage.removeItem('velo_verified');
    localStorage.removeItem('velo_verified_wallet');
  } catch (err) { /* ignore */ }
  window.location.href = 'index.html';
}
