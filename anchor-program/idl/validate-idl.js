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

console.log('\n=== 3. create_token instruction encoding (Vec<FeeSplitRecipientInput>, two recipients) ===');
const dummyWallet = Keypair.generate().publicKey;
const createBuf = coder.instruction.encode('create_token', {
  decimals: 6,
  totalSupply: new BN('1073000000000000'),
  recipients: [
    { creatorType: { wallet: {} }, socialHandle: null, wallet: dummyWallet, bps: 6000 },
    { creatorType: { x: {} }, socialHandle: 'CreatorX', wallet: null, bps: 4000 },
  ],
});
console.log('bytes length:', createBuf.length);
console.log('discriminator matches [84,52,204,228,24,140,234,75]:',
  createBuf.slice(0, 8).equals(Buffer.from([84,52,204,228,24,140,234,75])));
let offset = 8;
console.log('decimals byte:', createBuf.readUInt8(offset), '=== 6:', createBuf.readUInt8(offset) === 6);
offset += 1;
console.log('totalSupply:', createBuf.readBigUInt64LE(offset) === 1_073_000_000_000_000n);
offset += 8;
console.log('recipients Vec length (u32 = 2):', createBuf.readUInt32LE(offset), '=== 2:', createBuf.readUInt32LE(offset) === 2);
offset += 4;
console.log('recipient[0] creatorType tag (0 = Wallet):', createBuf.readUInt8(offset) === 0);
offset += 1;
console.log('recipient[0] socialHandle Option tag (0 = None):', createBuf.readUInt8(offset) === 0);
offset += 1;
console.log('recipient[0] wallet Option tag (1 = Some):', createBuf.readUInt8(offset) === 1);
offset += 1;
const walletBytes = createBuf.slice(offset, offset + 32);
console.log('recipient[0] wallet pubkey round-trips:', new PublicKey(walletBytes).equals(dummyWallet));
offset += 32;
console.log('recipient[0] bps (u16 LE = 6000):', createBuf.readUInt16LE(offset) === 6000);
offset += 2;
console.log('recipient[1] creatorType tag (1 = X):', createBuf.readUInt8(offset) === 1);
offset += 1;
console.log('recipient[1] socialHandle Option tag (1 = Some):', createBuf.readUInt8(offset) === 1);
offset += 1;
const handleLen = createBuf.readUInt32LE(offset);
offset += 4;
const handle = createBuf.slice(offset, offset + handleLen).toString('utf8');
console.log('recipient[1] socialHandle round-trips ("CreatorX"):', handle === 'CreatorX');
offset += handleLen;
console.log('recipient[1] wallet Option tag (0 = None):', createBuf.readUInt8(offset) === 0);
offset += 1;
console.log('recipient[1] bps (u16 LE = 4000):', createBuf.readUInt16LE(offset) === 4000);
offset += 2;
console.log('total bytes consumed matches buffer length:', offset === createBuf.length);

console.log('\n=== 4. claim_fee_split_wallet (recipientIndex: u8) ===');
const claimBuf = coder.instruction.encode('claim_fee_split_wallet', { recipientIndex: 1 });
console.log('length (discriminator + 1 byte = 9):', claimBuf.length === 9);
console.log('discriminator matches [109,193,106,20,185,128,129,21]:',
  claimBuf.slice(0, 8).equals(Buffer.from([109,193,106,20,185,128,129,21])));
console.log('recipientIndex byte === 1:', claimBuf.readUInt8(8) === 1);

console.log('\n=== 5. Account decoding round-trip (Global, BondingCurve, FeeSplitter) ===');
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

// FeeSplitter with 2 active recipients (out of the fixed 6-slot array) —
// recipient[0] Wallet (identity = 32-byte pubkey padded to 64), recipient[1]
// X (identity = UTF-8 handle padded to 64), recipients[2..5] all-zero padding.
function encodeRecipient({ tag, identity64, identityLen, bps, accrued, claimed }) {
  return Buffer.concat([
    Buffer.from([tag]),
    identity64,
    Buffer.from([identityLen]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(bps); return b; })(),
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(accrued)); return b; })(),
    (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(claimed)); return b; })(),
  ]);
}
const walletIdentity = Buffer.alloc(64);
authority.toBuffer().copy(walletIdentity, 0);
const xIdentity = Buffer.alloc(64);
Buffer.from('CreatorX', 'utf8').copy(xIdentity, 0);
const emptyIdentity = Buffer.alloc(64);
const emptyRecipient = encodeRecipient({ tag: 0, identity64: emptyIdentity, identityLen: 0, bps: 0, accrued: 0, claimed: 0 });
const splitterBuf = Buffer.concat([
  Buffer.from([167, 3, 25, 27, 195, 153, 169, 183]),
  authority.toBuffer(), // mint (reused for test)
  Buffer.from([2]), // recipient_count
  encodeRecipient({ tag: 0, identity64: walletIdentity, identityLen: 0, bps: 6000, accrued: 123456789, claimed: 0 }),
  encodeRecipient({ tag: 1, identity64: xIdentity, identityLen: 8, bps: 4000, accrued: 555, claimed: 100 }),
  emptyRecipient,
  emptyRecipient,
  emptyRecipient,
  emptyRecipient,
  Buffer.from([9]), // bump
]);
const decodedSplitter = coder.accounts.decode('FeeSplitter', splitterBuf);
console.log('FeeSplitter.recipientCount === 2:', decodedSplitter.recipientCount === 2);
console.log('FeeSplitter.recipients[0].creatorType is Wallet:', 'wallet' in decodedSplitter.recipients[0].creatorType);
console.log('FeeSplitter.recipients[0].bps === 6000:', decodedSplitter.recipients[0].bps === 6000);
console.log('FeeSplitter.recipients[0].accruedLamports === 123456789:', decodedSplitter.recipients[0].accruedLamports.toString() === '123456789');
console.log('FeeSplitter.recipients[1].creatorType is X:', 'x' in decodedSplitter.recipients[1].creatorType);
console.log('FeeSplitter.recipients[1].bps === 4000:', decodedSplitter.recipients[1].bps === 4000);
console.log('FeeSplitter.recipients[1].totalClaimedLamports === 100:', decodedSplitter.recipients[1].totalClaimedLamports.toString() === '100');
console.log('FeeSplitter.recipients.length === 6 (fixed-size array):', decodedSplitter.recipients.length === 6);
console.log('FeeSplitter.bump === 9:', decodedSplitter.bump === 9);

console.log('\nAll checks printed above — every one must read true.');
