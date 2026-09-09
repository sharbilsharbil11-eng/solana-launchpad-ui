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

```bash
npx serve .
# or
python3 -m http.server 8000
```

## Features

- **Internal Solana wallet** — a real ed25519 keypair is generated per visitor via `@solana/web3.js`, kept in `localStorage`, and shown in the header/profile with its live devnet balance, address copy, secret-key backup, and reset
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

```bash
# Vercel
vercel

# Netlify
netlify deploy --dir=.

# GitHub Pages — enable Pages for this repository
```

## License

All rights reserved. See [LICENSE](LICENSE). This is a design template, not an
open-source project: ask before reusing it.

## Documentation

Full documentation site: **https://nirholas.github.io/solana-launchpad-ui/**

- [Getting started](docs/getting-started.md) covers install and first run.
- [Examples](docs/examples.md) has copy-paste snippets.
