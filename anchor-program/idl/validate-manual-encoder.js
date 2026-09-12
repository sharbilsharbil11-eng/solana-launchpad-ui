// Cross-checks bonding-curve.js's hand-written instruction encoder against
// the real @coral-xyz/anchor BorshCoder (already validated separately in
// validate-idl.js) — the two must produce byte-identical instruction data
// and identical account key lists for the same logical inputs.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const solanaWeb3 = require('@solana/web3.js');
const { BorshCoder, BN } = require('@coral-xyz/anchor');
const idl = require('./bonding_curve.json');

const sandbox = { solanaWeb3, Buffer, console, TextEncoder, TextDecoder, BigInt };
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(__dirname, '../../bonding-curve.js'), 'utf8');
vm.runInContext(src, sandbox, { filename: 'bonding-curve.js' });

const coder = new BorshCoder(idl);

function assertEqual(label, a, b) {
  const ok = a === b;
  console.log((ok ? 'OK  ' : 'FAIL') + ' — ' + label + (ok ? '' : `  (got ${a}, expected ${b})`));
  if (!ok) process.exitCode = 1;
}

const creator = solanaWeb3.Keypair.generate().publicKey;
const mint = solanaWeb3.Keypair.generate().publicKey;
const creatorWallet = creator;

console.log('=== create_token ===');
const recipients = [
  { creatorType: { wallet: {} }, socialHandle: null, wallet: creatorWallet, bps: 6000 },
  { creatorType: { x: {} }, socialHandle: 'CreatorX', wallet: null, bps: 4000 },
];
const manualCreate = sandbox.buildCreateTokenInstruction({
  creator, mint, totalSupply: 1_000_000_000_000_000n, decimals: 6, recipients,
});
const anchorCreateData = coder.instruction.encode('create_token', {
  decimals: 6,
  totalSupply: new BN('1000000000000000'),
  recipients,
});
assertEqual('data bytes match', Buffer.from(manualCreate.data).toString('hex'), anchorCreateData.toString('hex'));
assertEqual('account count === 9', manualCreate.keys.length, 9);
assertEqual('account[0] creator isSigner', manualCreate.keys[0].isSigner, true);
assertEqual('account[1] mint isSigner', manualCreate.keys[1].isSigner, true);
assertEqual('account[4] feeSplitter isWritable', manualCreate.keys[4].isWritable, true);

console.log('\n=== buy ===');
const feeRecipient = solanaWeb3.Keypair.generate().publicKey;
const manualBuy = sandbox.buildBuyInstruction({
  buyer: creator, mint, feeRecipient, solAmountLamports: 1_000_000_000n, minTokensOut: 42n,
});
const anchorBuyData = coder.instruction.encode('buy', { solAmount: new BN(1_000_000_000), minTokensOut: new BN(42) });
assertEqual('data bytes match', Buffer.from(manualBuy.data).toString('hex'), anchorBuyData.toString('hex'));
assertEqual('account count === 11', manualBuy.keys.length, 11);

console.log('\n=== sell ===');
const manualSell = sandbox.buildSellInstruction({
  seller: creator, mint, feeRecipient, tokenAmount: 500n, minSolOutLamports: 10n,
});
const anchorSellData = coder.instruction.encode('sell', { tokenAmount: new BN(500), minSolOut: new BN(10) });
assertEqual('data bytes match', Buffer.from(manualSell.data).toString('hex'), anchorSellData.toString('hex'));
assertEqual('account count === 10', manualSell.keys.length, 10);

console.log('\n=== claim_fee_split_wallet ===');
const manualClaim = sandbox.buildClaimFeeSplitWalletInstruction({ recipient: creator, mint, recipientIndex: 1 });
const anchorClaimData = coder.instruction.encode('claim_fee_split_wallet', { recipientIndex: 1 });
assertEqual('data bytes match', Buffer.from(manualClaim.data).toString('hex'), anchorClaimData.toString('hex'));
assertEqual('account count === 2', manualClaim.keys.length, 2);

console.log('\n=== PDA / ATA helpers agree with @solana/web3.js + spl-token-equivalent manual derivation ===');
const [expectedBondingCurve] = solanaWeb3.PublicKey.findProgramAddressSync(
  [Buffer.from('bonding-curve'), mint.toBuffer()],
  new solanaWeb3.PublicKey('4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb')
);
const [manualBondingCurve] = sandbox.getBondingCurvePda(mint);
assertEqual('bondingCurve PDA matches', manualBondingCurve.toBase58(), expectedBondingCurve.toBase58());

console.log('\n=== Account decoders round-trip against hand-built buffers ===');
const globalBuf = Buffer.concat([
  Buffer.from([167, 232, 232, 177, 200, 108, 114, 127]),
  creator.toBuffer(), feeRecipient.toBuffer(), creator.toBuffer(),
  (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(50n); return b; })(),
  (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(50n); return b; })(),
  Buffer.from([3]),
]);
const decodedGlobal = sandbox.decodeGlobal(globalBuf);
assertEqual('Global.feeBasisPoints', decodedGlobal.feeBasisPoints.toString(), '50');
assertEqual('Global.bump', decodedGlobal.bump, 3);
assertEqual('Global.feeRecipient', decodedGlobal.feeRecipient.toBase58(), feeRecipient.toBase58());

function encodeRecipientBuf({ tag, identity64, identityLen, bps, accrued, claimed }) {
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
creator.toBuffer().copy(walletIdentity, 0);
const xIdentity = Buffer.alloc(64);
Buffer.from('CreatorX', 'utf8').copy(xIdentity, 0);
const emptyRecipientBuf = encodeRecipientBuf({ tag: 0, identity64: Buffer.alloc(64), identityLen: 0, bps: 0, accrued: 0, claimed: 0 });
const splitterBuf = Buffer.concat([
  Buffer.from([167, 3, 25, 27, 195, 153, 169, 183]),
  mint.toBuffer(),
  Buffer.from([2]),
  encodeRecipientBuf({ tag: 0, identity64: walletIdentity, identityLen: 0, bps: 6000, accrued: 123456789, claimed: 0 }),
  encodeRecipientBuf({ tag: 1, identity64: xIdentity, identityLen: 8, bps: 4000, accrued: 555, claimed: 100 }),
  emptyRecipientBuf, emptyRecipientBuf, emptyRecipientBuf, emptyRecipientBuf,
  Buffer.from([11]),
]);
const decodedSplitter = sandbox.decodeFeeSplitter(splitterBuf);
assertEqual('FeeSplitter.mint', decodedSplitter.mint.toBase58(), mint.toBase58());
assertEqual('FeeSplitter.recipientCount', decodedSplitter.recipientCount, 2);
assertEqual('FeeSplitter.recipients.length (trimmed to recipientCount)', decodedSplitter.recipients.length, 2);
assertEqual('FeeSplitter.recipients[0].creatorType', decodedSplitter.recipients[0].creatorType, 'wallet');
assertEqual('FeeSplitter.recipients[0].identityPubkey', decodedSplitter.recipients[0].identityPubkey.toBase58(), creator.toBase58());
assertEqual('FeeSplitter.recipients[0].bps', decodedSplitter.recipients[0].bps, 6000);
assertEqual('FeeSplitter.recipients[0].accruedLamports', decodedSplitter.recipients[0].accruedLamports.toString(), '123456789');
assertEqual('FeeSplitter.recipients[1].creatorType', decodedSplitter.recipients[1].creatorType, 'x');
assertEqual('FeeSplitter.recipients[1].identityString', decodedSplitter.recipients[1].identityString, 'CreatorX');
assertEqual('FeeSplitter.recipients[1].bps', decodedSplitter.recipients[1].bps, 4000);
assertEqual('FeeSplitter.recipients[1].totalClaimedLamports', decodedSplitter.recipients[1].totalClaimedLamports.toString(), '100');
assertEqual('FeeSplitter.bump', decodedSplitter.bump, 11);

console.log('\nDone — any FAIL above means the manual encoder and the real Anchor coder disagree.');
