#!/usr/bin/env bash
# Moves BTC's price on the local fork, for the Cash Out demo's price drop.
# Only works against scripts/local-demo.sh, where the oracle is a settable mock.
#
#   ./scripts/btc-price.sh 50000
set -euo pipefail
RPC=${RPC:-http://127.0.0.1:8545}
FEED=0x86bCF0841622a5dAC14A313a15f96A95421b9366   # MUSD PriceFeed (testnet), mocked by local-demo.sh
USD=${1:?usage: btc-price.sh <usd>}
cast rpc anvil_setStorageAt $FEED 0x0 "$(cast to-uint256 "${USD}000000000000000000")" --rpc-url $RPC >/dev/null
echo "BTC is now \$$(printf "%'d" "$USD") on the local fork"
