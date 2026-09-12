#!/usr/bin/env bash
# One-shot devnet deployment for the Velo bonding-curve program.
#
# WHY THIS SCRIPT EXISTS: the sandboxed environment this repo's Claude
# session runs in has its outbound network access restricted by an
# organization policy that blocks Solana RPC endpoints (devnet, mainnet,
# and third-party RPCs alike) and the Solana toolchain's release servers
# (release.anza.xyz) — confirmed directly, not assumed. So `anchor build`/
# `anchor deploy` cannot be run from inside that session no matter what is
# installed there. Run this script yourself, from a machine (or CI runner)
# with normal internet access.
#
# Usage:
#   ./deploy-devnet.sh <fee_recipient_pubkey>
#
# <fee_recipient_pubkey>: your own wallet address — where the 0.5% platform
#   fee from every buy/sell goes. Can be the same as your deploy wallet.
#
# Before running: make sure program-keypair.json and oracle-keypair.json
# are in this anchor-program/ directory (sent to you directly, not in git
# — see .gitignore). The Program ID they define
# (4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb) is already hardcoded in
# declare_id!(), Anchor.toml, and every frontend file that talks to the
# program — do not regenerate these keypairs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

FEE_RECIPIENT="${1:-}"
if [ -z "$FEE_RECIPIENT" ]; then
  echo "Usage: $0 <fee_recipient_pubkey>"
  exit 1
fi

if [ ! -f program-keypair.json ] || [ ! -f oracle-keypair.json ]; then
  echo "Missing program-keypair.json and/or oracle-keypair.json in $SCRIPT_DIR"
  echo "These were sent to you directly (not committed to git) — get them before running this."
  exit 1
fi

echo "=== 1/7: Toolchain ==="
if ! command -v rustc >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi
if ! command -v solana >/dev/null 2>&1; then
  sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
if ! command -v avm >/dev/null 2>&1; then
  cargo install --git https://github.com/coral-xyz/anchor avm --locked
fi
avm install latest
avm use latest

echo "=== 2/7: Place the real program keypair before building ==="
# Without this, `anchor build` generates a random new keypair and ignores
# the declare_id!() already in lib.rs, producing a Program ID mismatch.
mkdir -p target/deploy
cp program-keypair.json target/deploy/bonding_curve-keypair.json

echo "=== 3/7: Build ==="
anchor build

echo "=== 4/7: Verify the Program ID matches exactly ==="
KEYS_OUTPUT="$(anchor keys list)"
echo "$KEYS_OUTPUT"
if ! echo "$KEYS_OUTPUT" | grep -q "4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb"; then
  echo "ERROR: built Program ID does not match the expected 4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb"
  echo "Did target/deploy/bonding_curve-keypair.json get overwritten? Re-run from step 2."
  exit 1
fi

echo "=== 5/7: Deploy wallet + devnet SOL ==="
solana config set --url devnet
if [ ! -f "$HOME/.config/solana/id.json" ]; then
  solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json"
fi
echo "Deploy wallet: $(solana address)"
solana airdrop 2 || echo "Airdrop failed/rate-limited — top up manually at https://faucet.solana.com if the deploy below fails for insufficient funds."

echo "=== 6/7: Deploy ==="
anchor deploy --provider.cluster devnet

echo "=== 7/7: One-time platform initialization (0.5% platform + 0.5% creator fee) ==="
node scripts/initialize-platform.js "$FEE_RECIPIENT" https://api.devnet.solana.com

echo ""
echo "✅ Done. Program ID: 4NJruKvypWrYoM5iGj7a9JCg9aVoNzWaDLHk5AsLnVwb (devnet)"
echo "This is the same Program ID already hardcoded in every frontend file"
echo "(bonding-curve.js, lib.rs, Anchor.toml) — no frontend changes needed."
