/* ==========================================================
   PumpFun Clone - Real Blockchain Functionality & Wallet Connect
   ========================================================== */

const ADMIN_WALLET = '6r62faMkaF5svQ9QhNcMqp5JCjgQcn4kAj9MJns6wUJo';

const TOKEN_NAMES = [
  { name: 'PEPE2025', ticker: 'PEPE25', emoji: '🐸', color: '#6366f1,#a855f7', desc: 'The king of memes returns for 2025. Community-driven and unstoppable.' },
  { name: 'DogWifHat2', ticker: 'WIF2', emoji: '🐕', color: '#f472b6,#fb923c', desc: 'He still has the hat. And this time, he brought friends.' },
  { name: 'SolCat', ticker: 'SCAT', emoji: '🐱', color: '#facc15,#fb923c', desc: 'Fastest cat on the Solana blockchain. Meow to the moon.' },
  { name: 'MoonBoy', ticker: 'MOON', emoji: '🌙', color: '#3b82f6,#06b6d4', desc: 'We are all gonna make it. Diamond hands only.' },
  { name: 'WAGMI', ticker: 'WAGMI', emoji: '💎', color: '#22c55e,#16a34a', desc: 'We are stronger together. No paper hands allowed.' },
  { name: 'BONK2', ticker: 'BONK2', emoji: '💥', color: '#ef4444,#f97316', desc: 'BONK is back with a vengeance. Better than ever.' },
  { name: 'GigaChad', ticker: 'CHAD', emoji: '🗿', color: '#8b5cf6,#6366f1', desc: 'Born to degen. Forced to trade. Pure alpha energy.' },
  { name: 'Degen', ticker: 'DEGEN', emoji: '🚀', color: '#ec4899,#f43f5e', desc: 'Maximum copium achieved. We hold because we believe.' },
  { name: 'CopiumMax', ticker: 'COPE', emoji: '💊', color: '#14b8a6,#06b6d4', desc: 'The most based token on Solana. LFG & approves.' },
  { name: 'BasedGod', ticker: 'BASED', emoji: '✨', color: '#f59e0b,#ef4444', desc: 'The legend continues on-chain with full community backing.' }
];

const CREATOR_NAMES = [
  'degen_420.sol', 'whale_hunter', 'solana_maxi', 'crypto_chad',
  'pepe_lord', 'ape_together', 'diamond_hands', 'moon_shot',
  'based_dev', 'anon_builder', 'giga_brain', 'pump_master'
];

const CREATOR_COLORS = [
  '#f472b6,#a855f7', '#facc15,#fb923c', '#3b82f6,#06b6d4',
  '#22c55e,#16a34a', '#ef4444,#f97316', '#8b5cf6,#6366f1'
];

// Wallet Connection Handler
async function connectWallet() {
  try {
    if (window.solana && window.solana.isPhantom) {
      const response = await window.solana.connect();
      const userWallet = response.publicKey.toString();
      alert('Connected successfully! Wallet: ' + userWallet);
      
      // Update UI button text if exists
      const connectBtn = document.getElementById('connect-wallet-btn') || document.querySelector('.connect-btn');
      if (connectBtn) {
        connectBtn.innerText = userWallet.slice(0, 4) + '...' + userWallet.slice(-4);
      }
      return userWallet;
    } else {
      window.open('https://phantom.app/', '_blank');
      alert('Please install Phantom Wallet to connect!');
    }
  } catch (err) {
    console.error('User rejected connection:', err);
  }
}

// Attach event listeners to connect buttons automatically
document.addEventListener('click', (e) => {
  if (e.target.matches('button') && (e.target.innerText.toLowerCase().includes('connect') || e.target.innerText.includes('ربط'))) {
    connectWallet();
  }
});
