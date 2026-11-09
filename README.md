# Triplex dashboard

A Vite and TypeScript multi-page dashboard prototype. The account screens use Firebase Google Authentication and Firestore username claims when configured. Deposit, withdrawal, and transfer operations do not move funds.

## Local setup

1. Create a Firebase project and register a Web app.
2. Enable **Authentication → Google** and add your local and deployed hostnames to **Authentication → Settings → Authorized domains**.
3. Create a Firestore database and publish [`firestore.rules`](./firestore.rules).
4. Copy `.env.example` to `.env` and fill in the Firebase Web app values from **Project settings → Your apps**.
5. Install and run:

   ```sh
   npm install
   npm run dev
   ```

The client Firebase API key identifies the Firebase project; it is not a server secret. Firestore Security Rules, Firebase Auth restrictions, and trusted server-side code must enforce access and money-related operations.

## Firestore data

- `usernameClaims/{lowercaseUsername}` stores only `{ uid }` to reserve a unique username. No `users` collection is created.
- `accountRoles/{uid}` is created at first sign-in with `{ role: "user" }`. A user can create only their own `user` role once; client updates and deletes are denied. To grant admin access, use the Firebase Console to create or edit `accountRoles/{uid}` for the account's Firebase Authentication UID and set its `role` string to `admin`. The Admin navigation item and placeholder page appear only after this role is read.
- `balances/{uid}` is readable only by its owner and is not writable by the web client. If a trusted administrator or backend provisions a document, its `balanceCents` integer is displayed. Missing balances display as `$0.00`.
- `transfers` is fully denied to client access. Implement any future transfer in a trusted, authenticated backend with server-side authorization, balance checks, atomic writes, audit logging, and abuse controls. The current transfer panel only previews recipient lookup and amount entry; it does not submit a transfer.

## Render static site

Create a Render Static Site from this repository. The included [`render.yaml`](./render.yaml) sets `npm ci && npm run build` and publishes `dist`. Add the four `VITE_FIREBASE_*` values from `.env.example` as Render environment variables before building; Vite embeds these public client settings in the static bundle. Add the Render hostname to Firebase Authentication's authorized domains. Never put service-account credentials or private keys in Vite environment variables.

If deploying as a Render Web Service instead, use `npm run build` as the build command and `npm start` as the start command. The start script serves the built `dist` files on Render's `PORT`.
# TRIPLEX
