# Backstop web

The app for the Backstop vault: deposit and withdraw MUSD, watch the
liquidation loop, run a paid harvest, and read the vault's ledger. Everything
on the page is read from the chain; nothing is stored off-chain.

## Run it against a local chain

```sh
anvil
# in another terminal, from the repo root
forge script script/DemoLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

That deploys the vault over the test mocks with two depositors, one harvested
liquidation and one still pending. Then:

```sh
cd web
cp .env.example .env.local   # NEXT_PUBLIC_CHAIN=local, plus the printed vault address
npm install
npm run dev
```

To transact, import Anvil's second default key into your wallet and add the
network (RPC `http://127.0.0.1:8545`, chain id 31337).

## Public testnet demo

For anyone who wants to try it, such as judges, without waiting for a real
liquidation. The vault is the real contract; the pool under it is the test
mock, so the app can offer a "Liquidate a Trove" button.

1. Fund a fresh wallet with a little testnet BTC from
   [faucet.test.mezo.org](https://faucet.test.mezo.org) (about 0.001 BTC).
2. From the repo root, deploy. `--interactives` asks for the key instead of
   leaving it in your shell history, and `--slow` sends one transaction at a
   time, which Mezo requires:

   ```sh
   forge script script/DeployTestnetDemo.s.sol \
     --rpc-url https://rpc.test.mezo.org --broadcast --slow --interactives 1
   ```

3. Host the app with:

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_CHAIN` | `mezoTestnet` |
   | `NEXT_PUBLIC_VAULT_ADDRESS` | printed by the script |
   | `NEXT_PUBLIC_VAULT_DEPLOY_BLOCK` | printed by the script |
   | `NEXT_PUBLIC_DEMO` | `true` |

Testers then add Mezo Testnet to their wallet (chain id 31611, RPC
`https://rpc.test.mezo.org`), take BTC from the faucet, and use the demo panel
under the pool: get demo MUSD, deposit, liquidate a Trove, harvest, pause
withdrawals, withdraw.

The mocks are open by design: anyone can mint or burn demo MUSD and pause the
demo pool. It is a demo, not a deployment to hold anything of value.

## Deploy

Set these in the host's environment (Vercel, Netlify, anything that builds
Next.js):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_CHAIN` | `mezo` |
| `NEXT_PUBLIC_VAULT_ADDRESS` | printed by `script/Deploy.s.sol` |
| `NEXT_PUBLIC_VAULT_DEPLOY_BLOCK` | the block it was deployed in, so the ledger reads from there |
| `NEXT_PUBLIC_RPC_URL` | optional; defaults to `https://rpc.mezo.org` |

With no vault address the site still builds and shows a pre-launch state, so it
can go up before the contract does.

If the contract changes, regenerate the bindings from the repo root with
`forge build && npm --prefix web run abi`.
