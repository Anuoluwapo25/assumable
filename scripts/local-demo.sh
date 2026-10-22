#!/usr/bin/env bash
# A local copy of Mezo testnet with the market deployed and seeded, for
# clicking through the app with no testnet BTC.
#
#   ./scripts/local-demo.sh          # leaves anvil running on :8545
#
# Uses anvil's well-known dev keys. They are public; never use them anywhere real.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=http://127.0.0.1:8545
FORK_RPC=https://rpc.test.mezo.org
FEED=0x86bCF0841622a5dAC14A313a15f96A95421b9366       # MUSD PriceFeed (testnet)
RATES=0xD4D6c36A592A2c5e86035A6bca1d57747a567f37      # MUSD InterestRateManager (testnet)
BORROWER_OPS=0xCdF7028ceAB81fA0C6971208e83fa7872994beE5
MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
ZERO=0x0000000000000000000000000000000000000000

K0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # deployer
K1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d  # seller A
K2=0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a  # seller B
K3=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6  # holder, not listed
K4=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a  # buyer with MUSD
K5=0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba  # Cash Out order signer
BRIDGE=0x7b7c000000000000000000000000000000000012     # AssetsBridge precompile

if ! cast chain-id --rpc-url $RPC >/dev/null 2>&1; then
  echo "starting anvil (fork of Mezo testnet)…"
  # FORK_BLOCK pins the fork. The public RPC sometimes routes to a node that
  # lags far behind, which makes a fork of the very latest block fail.
  BLOCK=${FORK_BLOCK:-$(cast block-number --rpc-url $FORK_RPC)}
  anvil --fork-url $FORK_RPC --fork-block-number "$BLOCK" --port 8545 --silent &
  until cast chain-id --rpc-url $RPC >/dev/null 2>&1; do sleep 1; done
fi

# The public RPC throttles a cold fork; retry each step until it lands. A
# mined-but-reverted transaction (a gas estimate gone stale, for one) counts
# as a failure too: `cast send` exits 0 for those.
send() {
  local label=$1; shift
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if cast send --timeout 120 --rpc-url $RPC --json "$@" 2>/dev/null | grep -q '"status":"0x1"'; then
      echo "  ✓ $label"; return
    fi
    sleep 3
  done
  echo "  ✗ $label"; exit 1
}

echo "pinning the oracle at \$83,000 (Mezo's oracle is a precompile anvil can't run)…"
cast rpc anvil_setCode $FEED "$(forge inspect MockPriceFeed deployedBytecode)" --rpc-url $RPC >/dev/null
cast rpc anvil_setStorageAt $FEED 0x0 "$(cast to-uint256 83000000000000000000000)" --rpc-url $RPC >/dev/null

echo "deploying…"
OUT=$(forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --private-key $K0 --slow 2>&1)
POSITIONS=$(echo "$OUT" | awk '/TrovePositions/ {print $2}')
MARKET=$(echo "$OUT" | awk '/TroveMarket/ {print $2}')
DEPLOY_BLOCK=$(echo "$OUT" | awk '/deploy block/ {print $3}')
echo "  TrovePositions $POSITIONS"
echo "  TroveMarket    $MARKET"

echo "seeding…"
EXP=$(( $(date +%s) + 14*86400 ))
send "#1 opened by account 3 (0.2 BTC / 5,000 MUSD)" --private-key $K3 $POSITIONS 'openPosition(uint256,address,address)' 5000ether $ZERO $ZERO --value 0.2ether
send "#2 opened by account 1 (0.1 BTC / 3,000 MUSD)" --private-key $K1 $POSITIONS 'openPosition(uint256,address,address)' 3000ether $ZERO $ZERO --value 0.1ether
send "#3 opened by account 2 (0.05 BTC / 2,500 MUSD)" --private-key $K2 $POSITIONS 'openPosition(uint256,address,address)' 2500ether $ZERO $ZERO --value 0.05ether
send "#2 listed at 97% of equity" --private-key $K1 $POSITIONS 'setApprovalForAll(address,bool)' $MARKET true
send "" --private-key $K1 $MARKET 'list(uint256,uint8,uint256,uint256,uint64)' 2 1 9700 0 $EXP
send "#3 listed at 1,400 MUSD" --private-key $K2 $POSITIONS 'setApprovalForAll(address,bool)' $MARKET true
send "" --private-key $K2 $MARKET 'list(uint256,uint8,uint256,uint256,uint64)' 3 0 1400ether 0 $EXP
send "account 4 borrows 8,000 MUSD to shop with" --private-key $K4 $BORROWER_OPS 'openTrove(uint256,address,address)' 8000ether $ZERO $ZERO --value 0.3ether
send "" --private-key $K4 $MUSD 'approve(address,uint256)' $MARKET 12000ether
Q=$(cast call $MARKET 'quote(uint256)((bool,uint256,uint256,uint256,uint16,uint256,uint256))' 1 --rpc-url $RPC | tr -d '()')
COLL=$(echo "$Q" | cut -d, -f2 | awk '{print $1}'); DEBT=$(echo "$Q" | cut -d, -f3 | awk '{print $1}')
send "account 4 offers 7,000 MUSD on #1" --private-key $K4 $MARKET 'makeOffer(uint256,uint256,uint256,uint256,uint64)' 1 7000ether "$DEBT" "$COLL" $EXP

echo "raising the rate for new Troves to 4%, so the seeded 1% Troves show as locked…"
cast rpc anvil_setStorageAt $RATES 0x0 0x0000000000000000000000000000000000000000000000000000000001900190 --rpc-url $RPC >/dev/null

echo "Cash Out: standing in for the AssetsBridge precompile (anvil can't run it either)…"
cast rpc anvil_setCode $BRIDGE "$(forge inspect MockAssetsBridge deployedBytecode)" --rpc-url $RPC >/dev/null
SIGNER=$(cast wallet address --private-key $K5)
OUT=$(POSITIONS=$POSITIONS MARKET=$MARKET ORDER_SIGNER=$SIGNER \
  forge script script/DeployCashOut.s.sol --rpc-url $RPC --broadcast --private-key $K0 --slow 2>&1)
CASHOUT=$(echo "$OUT" | awk '/CashOutModule / {print $2}')
DIRECT=$(echo "$OUT" | awk '/DirectMUSDAdapter / {print $2}')
SWAP=$(echo "$OUT" | awk '/SwapBridgeAdapter / {print $2}')
echo "  CashOutModule  $CASHOUT"
send "bridge minimum set to testnet's 10 mUSDC" --private-key $K0 $BRIDGE 'setMinBridgeOutAmount(address,uint256)' 0xe1a26db653708A2AD8F824E92Db9852410e33A59 10000000

cat > web/.env.development.local <<ENV
# Written by scripts/local-demo.sh: the app against the local fork. Delete to go back.
NEXT_PUBLIC_CHAIN=mezoTestnet
NEXT_PUBLIC_RPC_URL=$RPC
NEXT_PUBLIC_POSITIONS_ADDRESS=$POSITIONS
NEXT_PUBLIC_MARKET_ADDRESS=$MARKET
NEXT_PUBLIC_DEPLOY_BLOCK=$DEPLOY_BLOCK
NEXT_PUBLIC_CASHOUT_MODULE=$CASHOUT
NEXT_PUBLIC_CASHOUT_DIRECT_ADAPTER=$DIRECT
NEXT_PUBLIC_CASHOUT_SWAP_ADAPTER=$SWAP
# anvil's public dev key #5: local only, never anywhere real.
ORDER_SIGNER_PRIVATE_KEY=$K5
MOCK_PAYOUT_DELAY_SECONDS=12
ENV
echo "wrote web/.env.development.local. Now: cd web && npm run dev"
echo "Drop BTC for the demo with: ./scripts/btc-price.sh 50000"
