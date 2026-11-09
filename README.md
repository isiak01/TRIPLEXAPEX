# Triplex

Triplex is a multi-page Vite dashboard with Firebase Authentication, a Firestore-backed account ledger, manually reviewed crypto deposit requests, live notifications, admin member management, and Cloudinary-hosted receipts.

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

- `users/{uid}` is the canonical account document. It stores `username`, `usernameLower`, `email`, `role`, `balanceCents`, `isBanned`, and audit timestamps. Notifications and transfers live in per-user subcollections. Deposit requests are stored in top-level `receipts/{autoId}` documents with `userId` (username), `uid` (Firebase account ID), `amount` (USD), `amountCents` (exact ledger value), email, asset, network, status, Firestore timestamps, and Cloudinary receipt URL/asset metadata.
- `usernames/{lowercaseUsername}` is a minimal uniqueness index; it stores only the owning UID. The existing `usernameClaims`, `accountRoles`, and `balances` documents are read server-side during first sign-in to migrate existing account details. They are not writable or readable by the browser after the new rules are published.
- Deposit addresses are selected by asset and network from the variables listed below. Only configured addresses are offered. The API records the selected network/address and the requested USD amount with each deposit request.
- Admin review uses a Firestore transaction. Approving a pending request updates its status, credits the user's `balanceCents` exactly once, and creates a user notification atomically. Rejection changes its status and notifies the user. Balance transfers are also validated and applied in a transaction.
- Firestore client rules allow users to read their own profile, notifications, and receipts, and allow admins to list pending receipts; they deny client writes to account balances, roles, bans, receipts, and transfers. The receipt queries use Firestore's automatic single-field indexes and do not require a custom composite index. Deploy rule changes with `firebase deploy --only firestore:rules`.
- On the first admin receipt-page request after this schema change, the API copies existing `users/{uid}/receipts` documents into the top-level collection and keeps the original documents for compatibility. The migration is one-time; receipt review updates both copies when applicable. New request submissions use a per-user idempotency key so retries do not create duplicate receipts.
- Existing administrator roles are migrated from `accountRoles/{uid}` on first sign-in. For a new administrator, create the user's `users/{uid}` document by signing in once and then set its `role` to `admin` in the Firebase Console. Only trusted administrators should have console access to this field.
- Admin approvals and bans are audited by reviewer UID and timestamp. A ban blocks signed-in API actions and the live profile listener immediately displays the account restriction screen.

## Supported deposit address variables

`BTC_BITCOIN`; `USDT_ETHEREUM`, `USDT_BSC`, `USDT_TRON`, `USDT_SOLANA`, `USDT_TON`; `USDC_ETHEREUM`, `USDC_SOLANA`, `USDC_ARBITRUM`, `USDC_SUI`; `ETH_ETHEREUM`, `ETH_ARBITRUM`; `BNB_BSC`; `SOL_SOLANA`; `GRAM_TON`; `TRX_TRON`; and `SUI_SUI`.

The offered USDT networks follow [Tether's supported protocol list](https://tether.to/en/supported-protocols/). Native USDC networks listed here are checked against [Circle's supported USDC contract list](https://developers.circle.com/stablecoins/usdc-contract-addresses). Verify every destination address and token/network combination with the receiving wallet provider before configuring it. The site does not infer, generate, or substitute wallet addresses.

## Installable app

The site includes a web app manifest, app icon, service worker, and an in-app installation prompt. Supported browsers can install Triplex from the prompt or browser menu.

## Profit projection and website assistant

The Profit progress page displays the user's actual credited balance separately from the supplied five-cycle USDT example. That example is hypothetical, is not a forecast or guaranteed return, and does not change account balances. No live trading feed or automated hourly/daily earnings engine is connected. The assistant uses prepared replies about verified site features; it is not a live AI service and cannot inspect payment or account records.
