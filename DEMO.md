# Cash Out: two-minute demo

**What it shows:** someone with Bitcoin gets ₦150,000 into a bank account with
one tap and keeps the Bitcoin. Then BTC crashes, and the app shows them the
way out before they lose anything.

## Before you record (5 minutes, once)

```sh
./scripts/local-demo.sh          # anvil fork of Mezo testnet; Assumable + Cash Out deployed and seeded
cd web && npm run dev            # http://localhost:3000/cash
```

In your browser wallet:

- add the network: RPC `http://127.0.0.1:8545`, chain id `31611`, currency `BTC`;
- import anvil's dev account #6 (public test key, local only):
  `0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e`.
  It holds test BTC and no loan yet, so it shows the first-time flow.

**Check MetaMask is on the local network, not Mezo Testnet.** Both use chain id
31611, so the wallet can't tell them apart. The app refuses to send if Cash Out
isn't on the wallet's network, but keep a separate network entry named
"Mezo Local" so it's obvious which one is selected.

Keep a terminal open at the repo root for the price drop. The oracle starts at
$83,000.

> The payout partner is the **mock**, and the screen says "Demo payout"
> wherever it appears. The loan, the 40% cap, the MUSD and the transfer to
> the partner are real contract calls on the fork. The bank payout itself is
> simulated.

## The script

**0:00 to 0:15: the problem.** *(Show /cash, wallet connected.)*

> "Bitcoin holders don't want to sell, but rent is paid in naira. Borrowing
> against BTC on Mezo works, but today that means Troves, MUSD, bridges and
> swaps. Here it's one screen."

**0:15 to 0:50: cash out.**

1. Type **150000** in *You receive* (NGN).
2. Choose **Bank account**, type *GTBank*, `0123456789`, *Ada Obi*.
3. Point at the quote as it appears:
   - *They receive ₦150,000*, then the *Total cost* line (tap it to open the fees);
   - *Bitcoin held as security*: the app worked out how much BTC this needs;
   - the note that a first loan's minimum stays in the wallet as dollars;
   - the blue sentence: **"Your Bitcoin is safe unless BTC falls below $… (a 6x% drop)."**

   > "No jargon: what arrives, what it costs, and one sentence about risk.
   > Underneath, the loan is held to 40% loan-to-value, far from MUSD's 90%
   > liquidation line."
4. Tap **Cash out ₦150,000** and confirm once in the wallet.

**0:50 to 1:10: the timeline.**

The screen switches to *On its way*: **Borrowed against your Bitcoin → Money
ready to send → Sent for payout → In your account (simulated)**. The first
three tick as the transaction lands, and the last about 12 seconds later.

> "One transaction: it borrowed MUSD against the BTC, checked the cap, and
> handed exactly that MUSD to an approved payout partner, at an address only
> our backend can sign for. The user never types a crypto address."

Tap the receipt link to show the single transaction, then **Cash out again**
to go back.

**1:10 to 1:35: BTC crashes.**

```sh
./scripts/btc-price.sh 40000
```

Within a few seconds the *Your Bitcoin* card turns red:

> **"BTC has fallen a long way. Your Bitcoin could be sold to cover the loan
> unless you act."** Your Bitcoin is safe unless BTC falls below $3x,xxx (a x% drop).

> "That's a 52% drop. Most apps send a liquidation notice after the fact.
> This one says it in plain words, while there's still time, and gives two
> ways out."

(No terminal? Drag the **What if BTC were…** slider to −52% instead. The card
shows the same warning, marked *Simulation*.)

**1:35 to 1:55: the way out.**

- **Sell the loan instead** opens the position on Assumable's market. A buyer
  takes over the BTC and the debt and pays the equity: the user walks away with
  what's left instead of losing it to liquidation.
- Or **Pay back**: type an amount and pay part of the loan from the dollars left
  in the wallet. The card turns calmer.

> "Cash Out is built on Assumable, which makes MUSD loans transferable. That
> turns 'about to be liquidated' into 'sell it to someone who wants it'."

**1:55 to 2:00: close.**

> "One tap from Bitcoin to naira. MUSD underneath every step, and the BTC
> stays theirs."

## Reset between takes

```sh
./scripts/btc-price.sh 83000
```

For a completely clean slate, stop anvil and run `./scripts/local-demo.sh` again.
