This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

**Self-contained:** This app runs entirely from this directory. It does not depend on the `ayin` repo. Pool list is read from `data/pool.json`. To regenerate it from the bundled sources, run `node scripts/merge-pools.js` (uses `data/sources/ayin.pool.json` and `data/sources/mobula.pair.2.json`).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Matomo Analytics

The app integrates [Matomo](https://matomo.org/) via [@socialgouv/matomo-next](https://github.com/SocialGouv/matomo-next). Analytics is **optional** and disabled unless configured.

**Enable Matomo:** copy `.env.example` to `.env.local` and set:

- `NEXT_PUBLIC_MATOMO_URL` — your Matomo instance URL (e.g. `https://matomo.example.com`)
- `NEXT_PUBLIC_MATOMO_SITE_ID` — your Matomo site ID

**What is tracked:**

- **Page views** — automatic on route change
- **Custom events** — swap (token pair + amounts), pool management (add/remove liquidity, pool name, amounts), staking (xAyin mint/burn, Pounder deposit/withdraw, LP stake/unstake with pool name and amount)


## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Dev support

You can support Ayin Retro development by sending a donation (ALPH or any token) to:

```
1DHQcZ2GXvZxETD32CjLEuzirreGiY2XAGX4BH86SasT
```

Use the **Donate** button in the site footer to send from your connected wallet.

Thank you !