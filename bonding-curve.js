/* ================================================================
   Velo — real on-chain bonding curve client
   ================================================================
   Talks directly to the deployed Anchor program (see anchor-program/)
   using only @solana/web3.js — no @coral-xyz/anchor at runtime.

   Why not @coral-xyz/anchor via CDN: its published "browser" build
   (dist/browser/index.js) is not actually a self-contained bundle —
   it still has bare imports like `from '@solana/web3.js'`, `from
   'bn.js'`, `from 'buffer'`, etc. that only a bundler (webpack/esbuild/
   vite) resolves. Loading it directly as a <script type="module"> from
   a CDN URL fails in a plain browser with no import map. Rather than
   risk the entire trading feature on an unbundled CDN import, every
   instruction/account layout here was hand-encoded and verified byte-
   for-byte against the real @coral-xyz/anchor BorshCoder loaded under
   Node (see anchor-program/idl/validate-idl.js) before writing this —
   so this file produces the exact same bytes Anchor's own coder would,
   with zero extra runtime dependencies beyond web3.js.
   ================================================================ */

const BONDING_CURVE_PROGRAM_ID = new solanaWeb3.PublicKey('4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb');
const TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSVAR_RENT_PUBKEY = new solanaWeb3.PublicKey('SysvarRent111111111111111111111111111111111');
const TOKEN_DECIMALS = 6;
const DEFAULT_TOTAL_SUPPLY = 1_000_000_000; // whole tokens; matches anchor-program/src/constants.rs conventions
const CURVE_COMPLETE_SOL_THRESHOLD_LAMPORTS = 85_000_000_000n; // 85 SOL — matches anchor-program/src/constants.rs

// Instruction discriminators — sha256("global:"+name)[0:8], computed and
// checked against the real Anchor coder (see idl/validate-idl.js).
const DISCRIMINATOR = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  create_token: [84, 52, 204, 228, 24, 140, 234, 75],
  buy: [102, 6, 61, 18, 1, 218, 235, 234],
  sell: [51, 230, 133, 164, 1, 127, 131, 173],
  claim_fee_split_wallet: [109, 193, 106, 20, 185, 128, 129, 21],
};
const ACCOUNT_DISCRIMINATOR = {
  Global: [167, 232, 232, 177, 200, 108, 114, 127],
  BondingCurve: [23, 183, 248, 55, 96, 216, 172, 96],
  FeeSplitter: [167, 3, 25, 27, 195, 153, 169, 183],
};
const MAX_FEE_SPLIT_RECIPIENTS = 5;
const FEE_SPLIT_TOTAL_BPS = 10000; // matches anchor-program/src/state.rs FEE_SPLIT_TOTAL_BPS

// ── Tiny borsh-compatible byte writer ──
class ByteWriter {
  constructor() { this.chunks = []; }
  bytes(arr) { this.chunks.push(Uint8Array.from(arr)); return this; }
  u8(n) { return this.bytes([n & 0xff]); }
  u16(n) {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, n, true);
    this.chunks.push(buf);
    return this;
  }
  u32(n) {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, n, true);
    this.chunks.push(buf);
    return this;
  }
  u64(n) {
    const buf = new Uint8Array(8);
    let big = typeof n === 'bigint' ? n : BigInt(Math.trunc(n));
    for (let i = 0; i < 8; i++) { buf[i] = Number(big & 0xffn); big >>= 8n; }
    this.chunks.push(buf);
    return this;
  }
  pubkey(pk) { this.chunks.push(pk.toBytes()); return this; }
  bool(b) { return this.u8(b ? 1 : 0); }
  optionNone() { return this.u8(0); }
  optionSome(writeFn) { this.u8(1); writeFn(this); return this; }
  string(s) {
    const bytes = new TextEncoder().encode(s);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, true);
    this.chunks.push(len, bytes);
    return this;
  }
  toBuffer() {
    const total = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.chunks) { out.set(c, offset); offset += c.length; }
    return out;
  }
}

// CreatorType tag bytes, in the exact order declared in state.rs:
// enum CreatorType { Wallet, X, TikTok, Gmail }
const CREATOR_TYPE_TAG = { wallet: 0, x: 1, tikTok: 2, gmail: 3 };

function encodeCreatorType(w, creatorType) {
  const key = Object.keys(creatorType)[0];
  if (!(key in CREATOR_TYPE_TAG)) throw new Error('Unknown creator type: ' + key);
  w.u8(CREATOR_TYPE_TAG[key]);
}

// ── PDA helpers ──
function getGlobalPda() {
  return solanaWeb3.PublicKey.findProgramAddressSync([new TextEncoder().encode('global')], BONDING_CURVE_PROGRAM_ID);
}
function getBondingCurvePda(mint) {
  return solanaWeb3.PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('bonding-curve'), mint.toBytes()],
    BONDING_CURVE_PROGRAM_ID
  );
}
function getFeeSplitterPda(mint) {
  return solanaWeb3.PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('fee-splitter'), mint.toBytes()],
    BONDING_CURVE_PROGRAM_ID
  );
}
function getAssociatedTokenAddress(mint, owner) {
  const [ata] = solanaWeb3.PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

function keyMeta(pubkey, { signer = false, writable = false } = {}) {
  return { pubkey, isSigner: signer, isWritable: writable };
}

// ── Instructions ──

/** Atomic launch: mint 100% of supply onto the curve, revoke mint/freeze authority,
 * activate the bonding curve, and link the fee splitter (up to
 * MAX_FEE_SPLIT_RECIPIENTS creator-side beneficiaries, each with their own
 * bps share and independently claimable balance) — one instruction.
 * `recipients`: [{ creatorType: {wallet:{}}|{x:{}}|..., socialHandle, wallet, bps }],
 * bps must sum to exactly FEE_SPLIT_TOTAL_BPS (10000 = 100% of the creator's
 * fee share — not of total trade volume). */
function buildCreateTokenInstruction({ creator, mint, totalSupply, decimals, recipients }) {
  const [bondingCurve] = getBondingCurvePda(mint);
  const [feeSplitter] = getFeeSplitterPda(mint);
  const curveTokenVault = getAssociatedTokenAddress(mint, bondingCurve);

  if (!recipients || recipients.length === 0 || recipients.length > MAX_FEE_SPLIT_RECIPIENTS) {
    throw new Error(`recipients must have 1 to ${MAX_FEE_SPLIT_RECIPIENTS} entries`);
  }
  const bpsSum = recipients.reduce((sum, r) => sum + r.bps, 0);
  if (bpsSum !== FEE_SPLIT_TOTAL_BPS) {
    throw new Error(`recipients' bps must sum to ${FEE_SPLIT_TOTAL_BPS} (got ${bpsSum})`);
  }

  const w = new ByteWriter().bytes(DISCRIMINATOR.create_token);
  w.u8(decimals);
  w.u64(totalSupply);
  w.u32(recipients.length); // Vec<FeeSplitRecipientInput> length prefix
  for (const r of recipients) {
    encodeCreatorType(w, r.creatorType);
    if (r.socialHandle) w.optionSome((w2) => w2.string(r.socialHandle)); else w.optionNone();
    if (r.wallet) w.optionSome((w2) => w2.pubkey(r.wallet)); else w.optionNone();
    w.u16(r.bps);
  }

  const keys = [
    keyMeta(creator, { signer: true, writable: true }),
    keyMeta(mint, { signer: true, writable: true }),
    keyMeta(bondingCurve, { writable: true }),
    keyMeta(curveTokenVault, { writable: true }),
    keyMeta(feeSplitter, { writable: true }),
    keyMeta(TOKEN_PROGRAM_ID),
    keyMeta(ASSOCIATED_TOKEN_PROGRAM_ID),
    keyMeta(solanaWeb3.SystemProgram.programId),
    keyMeta(SYSVAR_RENT_PUBKEY),
  ];
  return new solanaWeb3.TransactionInstruction({ programId: BONDING_CURVE_PROGRAM_ID, keys, data: w.toBuffer() });
}

function buildBuyInstruction({ buyer, mint, feeRecipient, solAmountLamports, minTokensOut }) {
  const [global] = getGlobalPda();
  const [bondingCurve] = getBondingCurvePda(mint);
  const [feeSplitter] = getFeeSplitterPda(mint);
  const curveTokenVault = getAssociatedTokenAddress(mint, bondingCurve);
  const buyerTokenAccount = getAssociatedTokenAddress(mint, buyer);

  const w = new ByteWriter().bytes(DISCRIMINATOR.buy).u64(solAmountLamports).u64(minTokensOut);

  const keys = [
    keyMeta(buyer, { signer: true, writable: true }),
    keyMeta(global),
    keyMeta(mint),
    keyMeta(bondingCurve, { writable: true }),
    keyMeta(curveTokenVault, { writable: true }),
    keyMeta(buyerTokenAccount, { writable: true }),
    keyMeta(feeRecipient, { writable: true }),
    keyMeta(feeSplitter, { writable: true }),
    keyMeta(TOKEN_PROGRAM_ID),
    keyMeta(ASSOCIATED_TOKEN_PROGRAM_ID),
    keyMeta(solanaWeb3.SystemProgram.programId),
  ];
  return new solanaWeb3.TransactionInstruction({ programId: BONDING_CURVE_PROGRAM_ID, keys, data: w.toBuffer() });
}

function buildSellInstruction({ seller, mint, feeRecipient, tokenAmount, minSolOutLamports }) {
  const [global] = getGlobalPda();
  const [bondingCurve] = getBondingCurvePda(mint);
  const [feeSplitter] = getFeeSplitterPda(mint);
  const curveTokenVault = getAssociatedTokenAddress(mint, bondingCurve);
  const sellerTokenAccount = getAssociatedTokenAddress(mint, seller);

  const w = new ByteWriter().bytes(DISCRIMINATOR.sell).u64(tokenAmount).u64(minSolOutLamports);

  const keys = [
    keyMeta(seller, { signer: true, writable: true }),
    keyMeta(global),
    keyMeta(mint),
    keyMeta(bondingCurve, { writable: true }),
    keyMeta(curveTokenVault, { writable: true }),
    keyMeta(sellerTokenAccount, { writable: true }),
    keyMeta(feeRecipient, { writable: true }),
    keyMeta(feeSplitter, { writable: true }),
    keyMeta(TOKEN_PROGRAM_ID),
    keyMeta(solanaWeb3.SystemProgram.programId),
  ];
  return new solanaWeb3.TransactionInstruction({ programId: BONDING_CURVE_PROGRAM_ID, keys, data: w.toBuffer() });
}

/** Trustless direct claim of one recipient's share — creator_type at that
 * index must be Wallet. No oracle. recipientIndex is this beneficiary's
 * position (0-4) in the fee splitter's recipients array. */
function buildClaimFeeSplitWalletInstruction({ recipient, mint, recipientIndex }) {
  const [feeSplitter] = getFeeSplitterPda(mint);
  const w = new ByteWriter().bytes(DISCRIMINATOR.claim_fee_split_wallet).u8(recipientIndex);
  const keys = [
    keyMeta(recipient, { signer: true, writable: true }),
    keyMeta(feeSplitter, { writable: true }),
  ];
  return new solanaWeb3.TransactionInstruction({ programId: BONDING_CURVE_PROGRAM_ID, keys, data: w.toBuffer() });
}

// ── Account decoding (all fields fixed-size — no manual offsets to compute by hand at call sites) ──
function readU64LE(buf, offset) {
  let big = 0n;
  for (let i = 7; i >= 0; i--) big = (big << 8n) | BigInt(buf[offset + i]);
  return big;
}

function decodeGlobal(data) {
  const b = new Uint8Array(data);
  let o = 8; // discriminator
  const authority = new solanaWeb3.PublicKey(b.slice(o, o + 32)); o += 32;
  const feeRecipient = new solanaWeb3.PublicKey(b.slice(o, o + 32)); o += 32;
  const oracleAuthority = new solanaWeb3.PublicKey(b.slice(o, o + 32)); o += 32;
  const feeBasisPoints = readU64LE(b, o); o += 8;
  const creatorFeeBasisPoints = readU64LE(b, o); o += 8;
  const bump = b[o];
  return { authority, feeRecipient, oracleAuthority, feeBasisPoints, creatorFeeBasisPoints, bump };
}

function decodeBondingCurve(data) {
  const b = new Uint8Array(data);
  let o = 8;
  const mint = new solanaWeb3.PublicKey(b.slice(o, o + 32)); o += 32;
  const creator = new solanaWeb3.PublicKey(b.slice(o, o + 32)); o += 32;
  const virtualTokenReserves = readU64LE(b, o); o += 8;
  const virtualSolReserves = readU64LE(b, o); o += 8;
  const realTokenReserves = readU64LE(b, o); o += 8;
  const realSolReserves = readU64LE(b, o); o += 8;
  const tokenTotalSupply = readU64LE(b, o); o += 8;
  const complete = b[o] === 1; o += 1;
  const bump = b[o];
  return { mint, creator, virtualTokenReserves, virtualSolReserves, realTokenReserves, realSolReserves, tokenTotalSupply, complete, bump };
}

const CREATOR_TYPE_FROM_TAG = ['wallet', 'x', 'tikTok', 'gmail'];
const FEE_SPLIT_RECIPIENT_SIZE = 1 + 64 + 1 + 2 + 8 + 8; // creatorType + identity + identityLen + bps + accrued + claimed

function decodeFeeSplitRecipient(b, o) {
  const creatorType = CREATOR_TYPE_FROM_TAG[b[o]]; o += 1;
  const identity = b.slice(o, o + 64); o += 64;
  const identityLen = b[o]; o += 1;
  const bps = b[o] | (b[o + 1] << 8); o += 2;
  const accruedLamports = readU64LE(b, o); o += 8;
  const totalClaimedLamports = readU64LE(b, o); o += 8;
  let identityPubkey = null;
  let identityString = null;
  if (creatorType === 'wallet') {
    identityPubkey = new solanaWeb3.PublicKey(identity.slice(0, 32));
  } else {
    identityString = new TextDecoder().decode(identity.slice(0, identityLen));
  }
  return { creatorType, identityPubkey, identityString, bps, accruedLamports, totalClaimedLamports };
}

function decodeFeeSplitter(data) {
  const b = new Uint8Array(data);
  let o = 8;
  const mint = new solanaWeb3.PublicKey(b.slice(o, o + 32)); o += 32;
  const recipientCount = b[o]; o += 1;
  const recipients = [];
  for (let i = 0; i < MAX_FEE_SPLIT_RECIPIENTS; i++) {
    recipients.push(decodeFeeSplitRecipient(b, o));
    o += FEE_SPLIT_RECIPIENT_SIZE;
  }
  const bump = b[o];
  return { mint, recipientCount, recipients: recipients.slice(0, recipientCount), bump };
}

async function fetchDecodedAccount(connection, address, expectedDiscriminatorName, decodeFn) {
  const info = await connection.getAccountInfo(address);
  if (!info) return null;
  const expected = ACCOUNT_DISCRIMINATOR[expectedDiscriminatorName];
  const actual = Array.from(info.data.slice(0, 8));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Account at ${address.toBase58()} is not a ${expectedDiscriminatorName} (discriminator mismatch)`);
  }
  return decodeFn(info.data);
}

function fetchGlobal(connection) {
  const [global] = getGlobalPda();
  return fetchDecodedAccount(connection, global, 'Global', decodeGlobal);
}
function fetchBondingCurve(connection, mint) {
  const [bc] = getBondingCurvePda(mint);
  return fetchDecodedAccount(connection, bc, 'BondingCurve', decodeBondingCurve);
}
function fetchFeeSplitter(connection, mint) {
  const [fs] = getFeeSplitterPda(mint);
  return fetchDecodedAccount(connection, fs, 'FeeSplitter', decodeFeeSplitter);
}

// ── High-level actions, signed by the internal Velo wallet (currentWallet from app.js) ──

async function sendVeloTransaction(connection, instructions, extraSigners = []) {
  if (!currentWallet) throw new Error('No wallet available yet — reload the page and try again.');
  const tx = new solanaWeb3.Transaction();
  instructions.forEach((ix) => tx.add(ix));
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = currentWallet.publicKey;
  tx.sign(currentWallet, ...extraSigners);
  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}

async function createTokenOnChain({ totalSupply = DEFAULT_TOTAL_SUPPLY, initialBuySol = 0, xHandle = null, recipients = null } = {}) {
  const connection = new solanaWeb3.Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  const global = await fetchGlobal(connection);
  if (!global) throw new Error('The platform has not been initialized on-chain yet.');

  const mintKeypair = solanaWeb3.Keypair.generate();
  const totalSupplyRaw = BigInt(totalSupply) * 10n ** BigInt(TOKEN_DECIMALS);

  // Fee splitter recipients (creator's 0.5% fee share, divided by bps —
  // FEE_SPLIT_TOTAL_BPS = 100% of that share, not of total trade volume).
  // Callers building a multi-recipient split (create.html's "Add recipient"
  // UI) pass `recipients` directly, already shaped as
  // [{ creatorType, socialHandle, wallet, bps }, ...]. Without it, this
  // falls back to the single-recipient default: either this wallet, or an
  // X handle — the program accepts CreatorType::X with no verification of
  // who actually owns that handle, so its fees just accrue safely in the
  // splitter until a real oracle-verified claim path exists.
  if (!recipients) {
    recipients = xHandle
      ? [{ creatorType: { x: {} }, socialHandle: xHandle, wallet: null, bps: FEE_SPLIT_TOTAL_BPS }]
      : [{ creatorType: { wallet: {} }, socialHandle: null, wallet: currentWallet.publicKey, bps: FEE_SPLIT_TOTAL_BPS }];
  }
  const createIx = buildCreateTokenInstruction({
    creator: currentWallet.publicKey,
    mint: mintKeypair.publicKey,
    totalSupply: totalSupplyRaw,
    decimals: TOKEN_DECIMALS,
    recipients,
  });

  const instructions = [createIx];
  if (initialBuySol > 0) {
    instructions.push(buildBuyInstruction({
      buyer: currentWallet.publicKey,
      mint: mintKeypair.publicKey,
      feeRecipient: global.feeRecipient,
      solAmountLamports: BigInt(Math.round(initialBuySol * solanaWeb3.LAMPORTS_PER_SOL)),
      minTokensOut: 0n, // dev-buy right after creation; no external price to slip against yet
    }));
  }

  const signature = await sendVeloTransaction(connection, instructions, [mintKeypair]);
  return { signature, mint: mintKeypair.publicKey.toBase58() };
}

async function buyOnChain({ mint, solAmount, slippageBps = 500 }) {
  const connection = new solanaWeb3.Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  const mintPubkey = new solanaWeb3.PublicKey(mint);
  const global = await fetchGlobal(connection);
  if (!global) throw new Error('Platform not initialized.');
  const curve = await fetchBondingCurve(connection, mintPubkey);
  if (!curve) throw new Error('This token has no bonding curve.');
  if (curve.complete) throw new Error('This curve has graduated — trading through it has ended.');

  const solAmountLamports = BigInt(Math.round(solAmount * solanaWeb3.LAMPORTS_PER_SOL));
  // Client-side estimate of tokens out, purely to compute a slippage floor —
  // the program re-derives the exact amount on-chain from live reserves.
  const feeBps = global.feeBasisPoints + global.creatorFeeBasisPoints;
  const solAfterFee = (solAmountLamports * (10000n - feeBps)) / 10000n;
  const k = curve.virtualSolReserves * curve.virtualTokenReserves;
  const newVirtualSol = curve.virtualSolReserves + solAfterFee;
  const newVirtualTokens = k / newVirtualSol;
  const estimatedTokensOut = curve.virtualTokenReserves - newVirtualTokens;
  const minTokensOut = (estimatedTokensOut * BigInt(10000 - slippageBps)) / 10000n;

  const ix = buildBuyInstruction({
    buyer: currentWallet.publicKey,
    mint: mintPubkey,
    feeRecipient: global.feeRecipient,
    solAmountLamports,
    minTokensOut,
  });
  const signature = await sendVeloTransaction(connection, [ix]);
  return { signature, estimatedTokensOut };
}

async function sellOnChain({ mint, tokenAmount, slippageBps = 500 }) {
  const connection = new solanaWeb3.Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  const mintPubkey = new solanaWeb3.PublicKey(mint);
  const global = await fetchGlobal(connection);
  if (!global) throw new Error('Platform not initialized.');
  const curve = await fetchBondingCurve(connection, mintPubkey);
  if (!curve) throw new Error('This token has no bonding curve.');
  if (curve.complete) throw new Error('This curve has graduated — trading through it has ended.');

  const tokenAmountRaw = BigInt(Math.round(tokenAmount * 10 ** TOKEN_DECIMALS));
  const k = curve.virtualSolReserves * curve.virtualTokenReserves;
  const newVirtualTokens = curve.virtualTokenReserves + tokenAmountRaw;
  const newVirtualSol = k / newVirtualTokens;
  const solOut = curve.virtualSolReserves - newVirtualSol;
  const feeBps = global.feeBasisPoints + global.creatorFeeBasisPoints;
  const estimatedSolOutAfterFee = (solOut * (10000n - feeBps)) / 10000n;
  const minSolOutLamports = (estimatedSolOutAfterFee * BigInt(10000 - slippageBps)) / 10000n;

  const ix = buildSellInstruction({
    seller: currentWallet.publicKey,
    mint: mintPubkey,
    feeRecipient: global.feeRecipient,
    tokenAmount: tokenAmountRaw,
    minSolOutLamports,
  });
  const signature = await sendVeloTransaction(connection, [ix]);
  return { signature, estimatedSolOutAfterFee };
}

/** Claims one recipient's share of a token's fee splitter (default: index 0,
 * the common single-recipient case from createTokenOnChain). Only works for
 * Wallet-type recipients — social (X/TikTok/Gmail) recipients need the
 * oracle-verified claim path, not built yet. */
async function claimFeeSplitWalletOnChain({ mint, recipientIndex = 0 }) {
  const connection = new solanaWeb3.Connection(SOLANA_RPC_ENDPOINT, 'confirmed');
  const mintPubkey = new solanaWeb3.PublicKey(mint);
  const splitter = await fetchFeeSplitter(connection, mintPubkey);
  if (!splitter) throw new Error('No fee splitter for this token.');
  if (recipientIndex >= splitter.recipientCount) throw new Error('No such recipient on this token.');
  const entry = splitter.recipients[recipientIndex];
  if (entry.creatorType !== 'wallet') throw new Error('This recipient is not a Wallet-type recipient — social claiming isn\'t wired up yet.');
  if (!entry.identityPubkey.equals(currentWallet.publicKey)) throw new Error('This recipient slot belongs to a different wallet.');
  if (entry.accruedLamports === 0n) throw new Error('Nothing accrued to claim yet.');

  const ix = buildClaimFeeSplitWalletInstruction({ recipient: currentWallet.publicKey, mint: mintPubkey, recipientIndex });
  const signature = await sendVeloTransaction(connection, [ix]);
  return { signature, claimedLamports: entry.accruedLamports };
}

// ── Real trade history & holders, read straight off-chain — no indexer.
// This is genuinely real data (not simulated): each trade is reconstructed
// from the actual pre/post SOL + token balance deltas of a real historical
// transaction that touched the bonding curve PDA. The trade-off of not
// having a backend indexer: fetching is one RPC round-trip per transaction
// (so `limit` should stay modest), and lookback is bounded by what
// getSignaturesForAddress returns — there's no deep pagination here. ──

async function fetchRecentTrades(connection, mint, { limit = 20 } = {}) {
  const mintPubkey = mint instanceof solanaWeb3.PublicKey ? mint : new solanaWeb3.PublicKey(mint);
  const [bondingCurve] = getBondingCurvePda(mintPubkey);
  const curveTokenVault = getAssociatedTokenAddress(mintPubkey, bondingCurve);
  const vaultBase58 = curveTokenVault.toBase58();
  const curveBase58 = bondingCurve.toBase58();

  const sigInfos = await connection.getSignaturesForAddress(bondingCurve, { limit });
  const trades = [];

  for (const sigInfo of sigInfos) {
    if (sigInfo.err) continue;
    let tx;
    try {
      tx = await connection.getTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
    } catch (err) {
      continue;
    }
    if (!tx || !tx.meta) continue;

    const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.toBase58()));
    const curveIndex = keys.indexOf(curveBase58);
    if (curveIndex === -1) continue;

    // The bonding curve PDA holds real SOL reserves as its own lamport
    // balance (no separate vault account) — its delta tells us buy vs sell.
    const solDeltaLamports = BigInt(tx.meta.postBalances[curveIndex]) - BigInt(tx.meta.preBalances[curveIndex]);
    if (solDeltaLamports === 0n) continue;

    const preVault = (tx.meta.preTokenBalances || []).find((b) => keys[b.accountIndex] === vaultBase58);
    const postVault = (tx.meta.postTokenBalances || []).find((b) => keys[b.accountIndex] === vaultBase58);
    if (!preVault || !postVault) continue;
    const tokenDeltaRaw = BigInt(postVault.uiTokenAmount.amount) - BigInt(preVault.uiTokenAmount.amount);
    if (tokenDeltaRaw === 0n) continue;

    const isBuy = solDeltaLamports > 0n; // SOL flowed into the curve => a buy
    const solAmount = Number(isBuy ? solDeltaLamports : -solDeltaLamports) / Number(solanaWeb3.LAMPORTS_PER_SOL);
    const tokenAmount = Number(isBuy ? -tokenDeltaRaw : tokenDeltaRaw) / 10 ** TOKEN_DECIMALS;

    trades.push({
      signature: sigInfo.signature,
      type: isBuy ? 'buy' : 'sell',
      solAmount,
      tokenAmount,
      price: tokenAmount > 0 ? solAmount / tokenAmount : 0,
      maker: keys[0], // fee payer / first signer — the buyer or seller in every instruction we build
      blockTime: tx.blockTime || sigInfo.blockTime || null,
    });
  }

  return trades; // newest first, matching getSignaturesForAddress order
}

// Top holders via getTokenLargestAccounts (the RPC method built for this —
// fast and doesn't scale with total holder count, unlike scanning every
// token account for the mint). Owners are resolved with one batched
// getMultipleAccountsInfo call.
async function fetchHolders(connection, mint, { topN = 10 } = {}) {
  const mintPubkey = mint instanceof solanaWeb3.PublicKey ? mint : new solanaWeb3.PublicKey(mint);
  const [bondingCurve] = getBondingCurvePda(mintPubkey);
  const curveTokenVault = getAssociatedTokenAddress(mintPubkey, bondingCurve);
  const vaultBase58 = curveTokenVault.toBase58();

  const largest = await connection.getTokenLargestAccounts(mintPubkey);
  // getTokenLargestAccounts returns `address` as a PublicKey instance, not a
  // string — normalize immediately so every later string comparison (and
  // the isCurve check below) actually works.
  const accounts = largest.value.slice(0, topN).map((a) => ({
    address: a.address instanceof solanaWeb3.PublicKey ? a.address.toBase58() : a.address,
    amount: a.amount,
  }));
  const addresses = accounts.map((a) => new solanaWeb3.PublicKey(a.address));
  const infos = addresses.length ? await connection.getMultipleAccountsInfo(addresses) : [];

  return accounts.map((a, i) => {
    const info = infos[i];
    // SPL token account layout: mint[0:32], owner[32:64], amount[64:72] (u64 LE), ...
    const owner = info ? new solanaWeb3.PublicKey(info.data.slice(32, 64)).toBase58() : a.address;
    return {
      tokenAccount: a.address,
      owner,
      amountRaw: BigInt(a.amount),
      isCurve: a.address === vaultBase58,
    };
  });
}

// A real total holder count needs a full scan (getTokenLargestAccounts only
// returns the top 20) — this costs one getProgramAccounts call, kept cheap
// with dataSlice length 0 so it counts matches without downloading data.
async function fetchHolderCount(connection, mint) {
  const mintPubkey = mint instanceof solanaWeb3.PublicKey ? mint : new solanaWeb3.PublicKey(mint);
  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
    filters: [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: mintPubkey.toBase58() } },
    ],
    dataSlice: { offset: 0, length: 0 },
  });
  return accounts.length;
}
