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
const manualCreate = sandbox.buildCreateTokenInstruction({
  creator, mint, totalSupply: 1_000_000_000_000_000n, decimals: 6,
  creatorType: { wallet: {} }, socialHandle: null, creatorWallet,
});
const anchorCreateData = coder.instruction.encode('create_token', {
  decimals: 6,
  totalSupply: new BN('1000000000000000'),
  creatorType: { wallet: {} },
  socialHandle: null,
  creatorWallet,
});
assertEqual('data bytes match', Buffer.from(manualCreate.data).toString('hex'), anchorCreateData.toString('hex'));
assertEqual('account count === 9', manualCreate.keys.length, 9);
assertEqual('account[0] creator isSigner', manualCreate.keys[0].isSigner, true);
assertEqual('account[1] mint isSigner', manualCreate.keys[1].isSigner, true);
assertEqual('account[4] creatorFeeVault isWritable', manualCreate.keys[4].isWritable, true);

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

console.log('\n=== claim_creator_fees_wallet ===');
const manualClaim = sandbox.buildClaimCreatorFeesWalletInstruction({ recipient: creator, mint });
const anchorClaimData = coder.instruction.encode('claim_creator_fees_wallet', {});
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

console.log('\nDone — any FAIL above means the manual encoder and the real Anchor coder disagree.');
