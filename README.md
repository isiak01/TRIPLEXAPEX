# TRIPLEAPEX

TRIPLEAPEX is a multi-page Vite dashboard with Firebase Authentication, a Firestore-backed account ledger, manually reviewed crypto deposit requests, live notifications, admin member management, and Cloudinary-hosted receipts.

## Local setup

1. Copy `.env.example` to `.env` and set the Firebase Web app values.
2. Put a Firebase service-account JSON value in `FIREBASE_SERVICE_ACCOUNT_JSON`. This is a private server credential; never commit it or put it in a `VITE_*` variable.
3. Configure a Cloudinary **signed upload preset**. Restrict its allowed formats to JPG, JPEG, PNG, WebP, and PDF and its maximum file size to 10 MB. Set the Cloudinary cloud name, API key, API secret, and preset name as server-only variables.
4. Add verified deposit wallet addresses to the server environment. A network without an address is shown as unavailable. Never use a private key or seed phrase as a deposit address.
5. Install dependencies and run the API and frontend in separate terminals:

   ```sh
   npm ci
   npm run api
   npm run dev
   ```

The Vite development server proxies `/api` requests to port 10000. `APP_ORIGINS` in `.env` lists the local development origins. The production server serves the built Vite site and API from one origin:

```sh
npm run build
npm start
```

## Render deployment

The included [`render.yaml`](./render.yaml) configures a Node web service that builds the site and starts `server.mjs`. Add the four `VITE_FIREBASE_*` client values, `FIREBASE_SERVICE_ACCOUNT_JSON`, the Cloudinary values, and the receiving wallet addresses in the Render service's Environment settings. The Cloudinary API secret and Firebase service-account JSON are server secrets and must never be exposed as `VITE_*` variables. If server credentials are missing, the site can still be served, but account/payment API calls return an explicit configuration error.

Set `APP_ORIGINS` to the exact public site origin if requests arrive through a custom proxy or domain. Create a Cloudinary signed upload preset with the format and size restrictions above. Enable PDF delivery in Cloudinary if admins need to view uploaded PDF receipts. Signed, authenticated-delivery uploads keep receipt files out of Firebase Storage; the API issues short-lived upload signatures and only admins can request temporary receipt-view links.

## Firestore data and access

- `users/{uid}` is the canonical account document. It stores `username`, `usernameLower`, `email`, `role`, `balanceCents`, `isBanned`, first-deposit bonus claim metadata, and audit timestamps. Notifications and transfers live in per-user subcollections. Deposit requests are stored in top-level `receipts/{autoId}` documents with `userId` (username), `uid` (Firebase account ID), `amount` (USD), `amountCents` (exact ledger value), quoted crypto quantity and USD price, first-deposit bonus cents/applied status after review, email, asset, network, status, Firestore timestamps, and Cloudinary receipt URL/asset metadata.
- `usernames/{lowercaseUsername}` is a minimal uniqueness index; it stores only the owning UID. The existing `usernameClaims`, `accountRoles`, and `balances` documents are read server-side during first sign-in to migrate existing account details. They are not writable or readable by the browser after the new rules are published.
- Deposit addresses are selected by asset and network from the variables listed below. Only configured addresses are offered. The API records the selected network/address and the requested USD amount with each deposit request.
- The deposit flow quotes BTC, ETH, BNB, SOL, GRAM, TRX, and SUI against the live CoinGecko USD spot price and treats USDT/USDC as USD-pegged 1:1. Authenticated quotes expire after five minutes and are recorded with the request; network fees and price movement can change the amount ultimately received. A failed or stale quote is shown as an error rather than silently using an old rate.
- The member's first approved deposit receives a one-time 20% USD gift bonus. Eligibility is checked and the bonus, deposit credit, receipt status, and notification are committed in the same Firestore transaction. The deposit screen previews the bonus; approval remains authoritative and duplicate or later approvals cannot claim it again.
- Withdrawal requests are stored in the top-level `withdrawals/{autoId}` collection. Submitting a request reserves the requested USD amount from the member's available balance and records their username, email, selected asset/network, destination wallet, and request status. Admins must record the actual crypto amount and transaction hash when marking a request paid; rejecting a pending request returns the reserved USD amount in the same Firestore transaction.
- A member can start one five-day profit cycle at a time using a selected amount from their available USD balance. New cycles use 19.5% daily growth followed by a 4% fee on the post-growth amount. Full-precision USD values are carried between days; only hourly ledger credits and daily fees are rounded to cents. Each cycle stores its rates so existing cycles retain their original terms. The server returns the reserved starting amount after day five; withdrawals and transfers are blocked while a cycle is active.
- Referral-agent assignments are administrator-only. `referralAgents/{uid}` and `referralCodes/{code}` are created only when an admin appoints a member; a transaction assigns the next unique `T-R-I-P-L-E-A-P-E-X-A-G-E-N-T-0-0-1`-style code and enforces the 86-agent 2026 limit. Existing `T-R-I-P-L-E-X-A-G-E-N-T` codes remain valid. `referrals/{uid}` records a user's single referral agent, and `referralRewards/{id}` plus the agent's activity ledger record rewards. An agent's $100 first-deposit reward is credited once when the referred member's first deposit is approved; a 10% share of net cycle profit after fees is credited for each completed five-day cycle. All referral data and balance updates are written by the authenticated server API; Firestore client writes remain denied.
- Admin review uses a Firestore transaction. Approving a pending deposit updates its status, credits the user's `balanceCents` exactly once, applies the first-deposit bonus when eligible, and creates a user notification atomically. Rejection changes its status and notifies the user. Balance transfers are also validated and applied in a transaction.
- Firestore client rules allow users to read their own profile, notifications, receipts, and withdrawals, and allow admins to list pending receipt and withdrawal requests; they deny client writes to account balances, roles, bans, receipts, withdrawals, and transfers. These status/UID queries use Firestore's automatic single-field indexes and do not require custom composite indexes. Deploy rule changes with `firebase deploy --only firestore:rules`.
- On the first admin receipt-page request after this schema change, the API copies existing `users/{uid}/receipts` documents into the top-level collection and keeps the original documents for compatibility. The migration is one-time; receipt review updates both copies when applicable. New request submissions use a per-user idempotency key so retries do not create duplicate receipts.
- Existing administrator roles are migrated from `accountRoles/{uid}` on first sign-in. For a new administrator, create the user's `users/{uid}` document by signing in once and then set its `role` to `admin` in the Firebase Console. Only trusted administrators should have console access to this field.
- Admin approvals and bans are audited by reviewer UID and timestamp. A ban blocks signed-in API actions and the live profile listener immediately displays the account restriction screen.

## Supported deposit address variables

`BTC_BITCOIN`; `USDT_ETHEREUM`, `USDT_BSC`, `USDT_TRON`, `USDT_SOLANA`, `USDT_TON`; `USDC_ETHEREUM`, `USDC_SOLANA`, `USDC_ARBITRUM`, `USDC_SUI`; `ETH_ETHEREUM`, `ETH_ARBITRUM`; `BNB_BSC`; `SOL_SOLANA`; `GRAM_TON`; `TRX_TRON`; and `SUI_SUI`.

The offered USDT networks follow [Tether's supported protocol list](https://tether.to/en/supported-protocols/). Native USDC networks listed here are checked against [Circle's supported USDC contract list](https://developers.circle.com/stablecoins/usdc-contract-addresses). Verify every destination address and token/network combination with the receiving wallet provider before configuring it. The site does not infer, generate, or substitute wallet addresses.

## Installable app

The site includes a web app manifest, app icon, service worker, and an in-app installation prompt. Supported browsers can install TRIPLEAPEX from the prompt or browser menu.

## Profit progress and website assistant

The profit cycle uses a five-day schedule: 19.5% daily growth followed by a 4% fee on the post-growth amount. The illustrative $10 projection carries full precision between days and formats values to cents only for display. The Node service processes due hourly entries, including entries missed during a restart, in Firestore transactions. The complete activity page shows the account's history. Withdrawal requests are paid manually by an administrator; the admin records the actual crypto amount and transaction hash after sending payment. The assistant uses prepared replies about website features and cannot inspect account or payment records.
