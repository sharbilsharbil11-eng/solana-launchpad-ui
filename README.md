# Velo — Solana Token Launchpad UI

> **Purpose:** UI template for a Solana token launchpad, branded as Velo. Board/create/trade/profile pages run on mock token data; wallets are real Solana keypairs generated client-side.

Solana token launchpad UI template. Token data is mocked, but each visitor gets a real ed25519 Solana wallet generated and stored in their browser — no external wallet extension required.

## Pages

| Page | File | Description |
|------|------|-------------|
| Board | `index.html` | Token grid with tabs (trending/new/top), King of the Hill banner, live activity ticker |
| Create | `create.html` | Token creation form with image upload, social links, mayhem mode, creator fees |
| Trade | `token.html` | Token detail with SVG price chart, buy/sell panel, thread/comments, trades table, holder distribution |
| Profile | `profile.html` | User profile with created/held tokens, activity history, favorites |

## Live Demo

[solana-launchpad-ui.vercel.app](https://solana-launchpad-ui.vercel.app) (verified serving 2026-07-30). Source: [github.com/nirholas/solana-launchpad-ui](https://github.com/nirholas/solana-launchpad-ui).

## Running Locally

The pages themselves are static, but the Profile login now calls real
serverless API routes (`/api/**`), so use the Vercel dev server rather than
a plain static file server:

```bash
npm install
npx vercel dev
```

`npx serve .` / `python3 -m http.server` still work for browsing the pages,
but the login modal's Google/GitHub/Wallet/etc. buttons need the `/api`
routes, which only run under `vercel dev` or an actual Vercel deployment.

## Features

- **Internal Solana wallet** — a real ed25519 keypair is generated per visitor via `@solana/web3.js`, kept in `localStorage`, and shown in the header/profile with its live devnet balance, address copy, secret-key backup, and reset
- **Real account login** — GitHub and Google are real OAuth (backed by Postgres); Wallet is a real signed-message proof of ownership verified server-side. X/TikTok/Kick/Email are placeholders until their own OAuth apps are registered (see below) — see [Real accounts setup](#real-accounts-setup)
- **Dark theme** with neon green accent
- **Responsive design** — mobile-first with breakpoints at 480/768/1024px
- **Activity ticker** — scrolling real-time trade feed
- **Token card grid** — with bonding curve progress bars, market cap, change %
- **King of the Hill** — highlighted banner for top token
- **Trading UI** — buy/sell toggle, quick amount buttons, slippage control
- **SVG price chart** — placeholder candlestick-style chart
- **Thread/comments** — chat section with emoji avatars
- **Transaction table** — buy/sell history with color coding
- **Holder distribution** — ranked list with percentage bars
- **Tab navigation** — Terminal, Trending, Top, New, Graduating, Graduated
- **Mobile nav** — overlay menu for small screens
- **Fade-in animations** — staggered card entrance
- **Skeleton loading** — shimmer effect CSS class available

## Customization

Edit CSS variables in `styles.css` `:root` to change the color scheme:

```css
--green: #7bff69;       /* Primary accent */
--bg: #0e0e16;          /* Background */
--bg-card: #181825;     /* Card background */
--border: #2a2a3e;      /* Border color */
```

## Deploying

Real account login (GitHub/Google/Wallet) requires Vercel specifically —
it's built as Vercel serverless functions under `/api`, backed by Vercel
Postgres. Netlify and GitHub Pages can still host the static pages and the
internal wallet feature, but the login modal's buttons will fail without
that backend.

```bash
vercel
```

## Real accounts setup

The login modal ("Verify with...") is wired to a real backend, but it needs
one-time setup before GitHub/Google sign-in and wallet linking will work in
production:

1. **Add Postgres.** In the Vercel dashboard, open this project → **Storage**
   → **Create Database** → **Postgres**, and connect it to the project.
   Vercel injects `POSTGRES_URL` automatically — no manual config needed.
2. **Create a GitHub OAuth App.** Go to
   [github.com/settings/developers](https://github.com/settings/developers)
   → **New OAuth App**. Set the **Authorization callback URL** to
   `https://<your-domain>/api/auth/github/callback`. Copy the Client ID and
   generate a Client Secret.
3. **Create a Google OAuth client.** Go to
   [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
   → **Create Credentials** → **OAuth client ID** → **Web application**. Set
   the **Authorized redirect URI** to
   `https://<your-domain>/api/auth/google/callback`. Copy the Client ID and
   Client Secret.
4. **Set environment variables** in the Vercel project's Settings →
   Environment Variables (see `.env.example` for the full list):
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` (any long random string, e.g.
   `openssl rand -hex 32`), and `APP_BASE_URL` (your deployed URL, e.g.
   `https://velo.vercel.app`).
5. **Redeploy** so the new environment variables and Postgres connection
   take effect.

Until these are set, GitHub/Google buttons show a clear "not configured yet"
message instead of failing silently, and Wallet/placeholder methods will
return a server error until Postgres is connected.

X, TikTok, Kick, and Email aren't wired to real OAuth yet — each needs its
own developer app registration (and, for X, a paid API tier) before it can
work the same way GitHub/Google do. They currently go through a
placeholder endpoint (`api/auth/mock/callback.js`) that still creates a
real server session, so the rest of the app (profile gating, logout)
behaves consistently — it just doesn't verify a real external account yet.

## License

All rights reserved. See [LICENSE](LICENSE). This is a design template, not an
open-source project: ask before reusing it.

## Documentation

Full documentation site: **https://nirholas.github.io/solana-launchpad-ui/**

- [Getting started](docs/getting-started.md) covers install and first run.
- [Examples](docs/examples.md) has copy-paste snippets.
