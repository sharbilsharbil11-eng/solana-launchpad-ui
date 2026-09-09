#!/usr/bin/env node
/**
 * One-time platform initialization — run this ONCE after `anchor deploy`,
 * from a machine with real network access (this sandbox has none).
 *
 * Usage:
 *   node anchor-program/scripts/initialize-platform.js <fee_recipient_pubkey> [cluster_url]
 *
 * <fee_recipient_pubkey>: your own wallet address — where the 0.5% platform
 *   fee from every buy/sell goes. Can be the same as your deploy wallet.
 * [cluster_url]: defaults to https://api.devnet.solana.com
 *
 * Requires: ~/.config/solana/id.json to exist (your deploy wallet — same
 * one `anchor deploy` used) and to hold a little SOL for the transaction fee.
 *
 * This does NOT need @coral-xyz/anchor or the Anchor CLI — it builds the
 * `initialize` instruction by hand (same scheme as bonding-curve.js, byte-
 * verified against the real Anchor coder in idl/validate-idl.js) and sends
 * it with plain @solana/web3.js.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram,
} = require('@solana/web3.js');

const PROGRAM_ID = new PublicKey('4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb');
const FEE_BASIS_POINTS = 50; // 0.5%
const CREATOR_FEE_BASIS_POINTS = 50; // 0.5%

function loadKeypairFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function u64LE(n) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(n));
  return buf;
}

async function main() {
  const feeRecipientArg = process.argv[2];
  const clusterUrl = process.argv[3] || 'https://api.devnet.solana.com';
  if (!feeRecipientArg) {
    console.error('Usage: node initialize-platform.js <fee_recipient_pubkey> [cluster_url]');
    process.exit(1);
  }
  const feeRecipient = new PublicKey(feeRecipientArg);

  const deployWalletPath = path.join(os.homedir(), '.config/solana/id.json');
  const authority = loadKeypairFile(deployWalletPath);

  const oracleKeypairPath = path.join(__dirname, '..', 'oracle-keypair.json');
  const oracleAuthority = loadKeypairFile(oracleKeypairPath).publicKey;

  const [global] = PublicKey.findProgramAddressSync([Buffer.from('global')], PROGRAM_ID);

  console.log('Authority (deploy wallet): ', authority.publicKey.toBase58());
  console.log('Global PDA:                ', global.toBase58());
  console.log('Fee recipient (platform):  ', feeRecipient.toBase58());
  console.log('Oracle authority (unused for now, needed for X/social claims later):', oracleAuthority.toBase58());
  console.log('Platform fee:  ', FEE_BASIS_POINTS / 100, '%');
  console.log('Creator fee:   ', CREATOR_FEE_BASIS_POINTS / 100, '%');

  // initialize discriminator: sha256("global:initialize")[0:8] — verified in idl/validate-idl.js
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
  const data = Buffer.concat([discriminator, u64LE(FEE_BASIS_POINTS), u64LE(CREATOR_FEE_BASIS_POINTS)]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: true },
      { pubkey: feeRecipient, isSigner: false, isWritable: false },
      { pubkey: oracleAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const connection = new Connection(clusterUrl, 'confirmed');
  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = authority.publicKey;
  tx.sign(authority);

  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

  console.log('\n✅ Platform initialized. Signature:', signature);
  console.log(`Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}

main().catch((err) => {
  console.error('Initialization failed:', err);
  process.exit(1);
});
