// One-off validation script (not shipped) — loads the hand-written IDL with
// the real @coral-xyz/anchor BorshCoder and checks that instruction encoding
// and account decoding produce exactly the bytes the Rust program expects,
// without needing the Solana/Anchor toolchain to actually compile it.
const { BorshCoder, BN } = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram, Keypair } = require('@solana/web3.js');
const idl = require('./bonding_curve.json');

const coder = new BorshCoder(idl);

function hex(buf) { return Buffer.from(buf).toString('hex'); }

console.log('=== 1. initialize instruction encoding ===');
const initBuf = coder.instruction.encode('initialize', {
  feeBasisPoints: new BN(50),
  creatorFeeBasisPoints: new BN(50),
});
console.log('bytes:', hex(initBuf));
console.log('discriminator matches [175,175,109,31,13,152,155,237]:',
  initBuf.slice(0, 8).equals(Buffer.from([175,175,109,31,13,152,155,237])));
// After discriminator: two u64 little-endian values, 50 each = 0x32
const feeBps = initBuf.readBigUInt64LE(8);
const creatorFeeBps = initBuf.readBigUInt64LE(16);
console.log('feeBasisPoints decoded back:', feeBps, '=== 50n:', feeBps === 50n);
console.log('creatorFeeBasisPoints decoded back:', creatorFeeBps, '=== 50n:', creatorFeeBps === 50n);
console.log('total instruction length (8 + 8 + 8 = 24):', initBuf.length === 24);

console.log('\n=== 2. buy instruction encoding ===');
const buyBuf = coder.instruction.encode('buy', {
  solAmount: new BN(1_000_000_000), // 1 SOL
  minTokensOut: new BN(12345),
});
console.log('bytes:', hex(buyBuf));
console.log('discriminator matches [102,6,61,18,1,218,235,234]:',
  buyBuf.slice(0, 8).equals(Buffer.from([102,6,61,18,1,218,235,234])));
console.log('solAmount round-trips:', buyBuf.readBigUInt64LE(8) === 1_000_000_000n);
console.log('minTokensOut round-trips:', buyBuf.readBigUInt64LE(16) === 12345n);

console.log('\n=== 3. create_token instruction encoding (Wallet creator type, Option<T> handling) ===');
const dummyWallet = Keypair.generate().publicKey;
const createBuf = coder.instruction.encode('create_token', {
  decimals: 6,
  totalSupply: new BN('1073000000000000'),
  creatorType: { wallet: {} }, // Anchor enum encoding: object keyed by the exact IDL variant name
  socialHandle: null,
  creatorWallet: dummyWallet,
});
console.log('bytes length:', createBuf.length);
console.log('discriminator matches [84,52,204,228,24,140,234,75]:',
  createBuf.slice(0, 8).equals(Buffer.from([84,52,204,228,24,140,234,75])));
let offset = 8;
console.log('decimals byte:', createBuf.readUInt8(offset), '=== 6:', createBuf.readUInt8(offset) === 6);
offset += 1;
console.log('totalSupply:', createBuf.readBigUInt64LE(offset) === 1_073_000_000_000_000n);
offset += 8;
console.log('creatorType enum tag byte (0 = Wallet):', createBuf.readUInt8(offset), '=== 0:', createBuf.readUInt8(offset) === 0);
offset += 1;
console.log('socialHandle Option tag (0 = None):', createBuf.readUInt8(offset), '=== 0:', createBuf.readUInt8(offset) === 0);
offset += 1;
console.log('creatorWallet Option tag (1 = Some):', createBuf.readUInt8(offset), '=== 1:', createBuf.readUInt8(offset) === 1);
offset += 1;
const walletBytes = createBuf.slice(offset, offset + 32);
console.log('creatorWallet pubkey round-trips:', new PublicKey(walletBytes).equals(dummyWallet));

console.log('\n=== 4. claim_creator_fees_wallet (no args) ===');
const claimBuf = coder.instruction.encode('claim_creator_fees_wallet', {});
console.log('length (discriminator only, 8 bytes):', claimBuf.length === 8);
console.log('discriminator matches [91,168,209,79,139,75,175,59]:',
  claimBuf.slice(0, 8).equals(Buffer.from([91,168,209,79,139,75,175,59])));

console.log('\n=== 5. Account decoding round-trip (Global, BondingCurve, CreatorFeeVault) ===');
// Build a fake Global account buffer exactly as the Rust struct would lay it out:
// 8-byte discriminator + authority(32) + fee_recipient(32) + oracle_authority(32) + fee_bps(8) + creator_fee_bps(8) + bump(1)
const authority = Keypair.generate().publicKey;
const feeRecipient = Keypair.generate().publicKey;
const oracleAuthority = Keypair.generate().publicKey;
const globalBuf = Buffer.concat([
  Buffer.from([167, 232, 232, 177, 200, 108, 114, 127]),
  authority.toBuffer(),
  feeRecipient.toBuffer(),
  oracleAuthority.toBuffer(),
  (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(50n); return b; })(),
  (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(50n); return b; })(),
  Buffer.from([7]), // bump
]);
const decodedGlobal = coder.accounts.decode('Global', globalBuf);
console.log('Global.authority matches:', decodedGlobal.authority.equals(authority));
console.log('Global.feeRecipient matches:', decodedGlobal.feeRecipient.equals(feeRecipient));
console.log('Global.oracleAuthority matches:', decodedGlobal.oracleAuthority.equals(oracleAuthority));
console.log('Global.feeBasisPoints === 50:', decodedGlobal.feeBasisPoints.toString() === '50');
console.log('Global.creatorFeeBasisPoints === 50:', decodedGlobal.creatorFeeBasisPoints.toString() === '50');
console.log('Global.bump === 7:', decodedGlobal.bump === 7);

// CreatorFeeVault with creatorType Wallet + identity = 32-byte pubkey padded to 64
const identity = Buffer.alloc(64);
authority.toBuffer().copy(identity, 0);
const vaultBuf = Buffer.concat([
  Buffer.from([21, 14, 215, 247, 197, 137, 200, 121]),
  authority.toBuffer(), // mint (reused for test)
  Buffer.from([0]), // CreatorType::Wallet tag
  identity,
  Buffer.from([0]), // identity_len (unused for Wallet)
  (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(123456789n); return b; })(), // accrued_lamports
  (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(0n); return b; })(), // total_claimed_lamports
  Buffer.from([9]), // bump
]);
const decodedVault = coder.accounts.decode('CreatorFeeVault', vaultBuf);
console.log('CreatorFeeVault.creatorType is Wallet:', 'wallet' in decodedVault.creatorType);
console.log('CreatorFeeVault.accruedLamports === 123456789:', decodedVault.accruedLamports.toString() === '123456789');
console.log('CreatorFeeVault.bump === 9:', decodedVault.bump === 9);

console.log('\nAll checks printed above — every one must read true.');
