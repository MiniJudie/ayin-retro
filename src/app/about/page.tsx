import Link from 'next/link'
import { Header } from '@/components/Header'

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Header />
      <main className="px-4 pb-12 pt-28">
        <div className="mx-auto max-w-2xl space-y-8">
          <div>
            <h1 className="text-2xl font-bold text-white">About Ayin Retro</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">
              A simple interface for the Ayin DEX on Alephium.
            </p>
          </div>
          <section className="rounded-xl border-2 border-amber-500/60 bg-amber-500/15 p-6">
            <div className="flex items-center gap-2">
              <svg className="h-6 w-6 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h2 className="text-lg font-bold text-amber-200">Disclaimer</h2>
            </div>
            <p className="mt-3 text-sm font-medium leading-relaxed text-amber-100/95">
              This interface is provided as is. We are not responsible for misuse or loss of funds. Always verify transactions and contract addresses. Use at your own risk.
            </p>
          </section>

          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6">
            <h2 className="text-lg font-semibold text-white">Alternative initiatives</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              Other community tools you may find useful:
            </p>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
              <li>
                <Link
                  href="https://ayin.krk0d3r.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-white underline hover:no-underline"
                >
                  ayin.krk0d3r.com
                </Link>
                {' — access Ayin MetaFi CLAMM pools (by krk0d3r).'}
              </li>
              <li>
                <Link
                  href="https://lbqds.github.io/ayin-withdraw-tool/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-white underline hover:no-underline"
                >
                  Ayin Withdraw Tool
                </Link>
                {' — withdraw from Pounder (by Muchen).'}
              </li>
            </ul>
          </section>

          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6">
            <h2 className="text-lg font-semibold text-white">What is this?</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              Ayin Retro is a web interface for interacting with Ayin liquidity pools, swaps, and staking on the Alephium blockchain. You can browse pools, add or remove liquidity, swap tokens, and stake LP tokens or AYIN (xAyin, Pounder vault).
            </p>
          </section>

          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6">
            <h2 className="text-lg font-semibold text-white">Why?</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              This project exists following the shutdown of the official Ayin front website and Ayin Classic. Ayin Retro is a community interface to keep using Ayin pools, swap, and staking on Alephium.
            </p>
          </section>

         

          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6">
            <h2 className="text-lg font-semibold text-white">Features</h2>
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[var(--muted)]">
              <li>Pool list with reserves and LP balances</li>
              <li>Swap between token pairs</li>
              <li>Add / remove liquidity for any pool</li>
              <li>xAyin mint and burn (liquid staking)</li>
              <li>Pounder vault deposit and withdraw</li>
              <li>LP pool staking (stake and unstake)</li>
            </ul>
          </section>



          <section className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6">
            <h2 className="text-lg font-semibold text-white">Source code</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              This project is provided open-source without any maintenance ambition. Anyone willing to maintain or improve it is very welcome to fork the repository and run their own instance.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
              Artifacts in this interface—including the pool list—were extracted from the original Ayin Classic front-end while it was still running, and cross-referenced with data from internet archives and Mobula. The UI itself was rebuilt using Cursor.
            </p>
            <p className="mt-2 text-sm text-[var(--muted)]">
              <Link
                href="https://github.com/MiniJudie/ayin-retro"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-white underline hover:no-underline"
              >
                GitHub — ayin-retro
              </Link>
            </p>
          </section>

          <p className="text-center text-sm text-[var(--muted)]">
            <Link href="/" className="font-medium text-white hover:underline">
              ← Back to Pools
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
