"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useRef } from "react";
import { ProofStrip } from "@/components/landing/proof-strip";
import { VerifyConsole } from "@/components/verification/verify-console";

/**
 * The front door, and a graded deliverable.
 *
 * PRD §13.1 puts Verify at `/` and the operator console at `/dashboard`. The
 * prototype shipped those the other way round, so a visitor's first screen was
 * an operator panel offering to bypass stage 02. This restores the spec order.
 *
 * The page answers three questions in the order a stranger asks them: what is
 * this, is it real, and can I try it. The proof strip sits between the first
 * two because the fastest way to end "is this a mockup" is a number that moves
 * when you reload.
 *
 * The canvas is loaded client-side only. WebGL has no server render, and the
 * paste box below is a mandatory deliverable that must not depend on a GPU
 * context succeeding.
 */
const HeroCanvas = dynamic(
  () => import("@/components/landing/hero-canvas").then((m) => m.HeroCanvas),
  { ssr: false },
);

const STAGES = [
  {
    num: "01",
    name: "Detect",
    line: "Eight public newswires, polled continuously. Keyword gates screen out commentary, questions, rallies and anything naming no hedgeable asset — every rejection carries its reason.",
  },
  {
    num: "02",
    name: "Investigate",
    line: "Before any model is asked, the claim is measured against Base mainnet: balance deltas, transfer activity, contract state, pool depth, oracle divergence, TVL.",
  },
  {
    num: "03",
    name: "Analyze",
    line: "Three independent models on the Gonka network score the claim against that evidence, in parallel. Each returns a score, a stance, its reasoning and a request id.",
  },
  {
    num: "04",
    name: "Challenge",
    line: "When the three disagree, a synthesis round runs to resolve it. Agreement is measured, not assumed, and it has its own threshold.",
  },
  {
    num: "05",
    name: "Decide",
    line: "Truth and agreement are checked against the policy matrix, then the size is bound by whichever limit bites first — reserve, daily cap, hard ceiling, or the book itself.",
  },
  {
    num: "06",
    name: "Protect",
    line: "A real protective put is bought on the Thetanuts OptionBook on Base mainnet, and an attestation links the trade to the exact reasoning that caused it.",
  },
];

export default function LandingPage() {
  const verifyRef = useRef<HTMLDivElement | null>(null);

  const scrollToVerify = useCallback(() => {
    verifyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <>
      <HeroCanvas />

      {/* ── Chrome ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#05070b]/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/logo.png"
              alt=""
              width={40}
              height={40}
              priority
              className="h-9 w-9 object-contain drop-shadow-[0_0_12px_rgba(16,185,129,0.4)]"
            />
            <span className="font-mono-code text-lg font-extrabold tracking-wider text-white">
              NUT<span className="text-emerald-400">SHELL</span>
            </span>
          </Link>

          <nav className="flex items-center gap-1.5">
            <Link
              href="/signals"
              className="hidden rounded-lg px-3 py-1.5 font-mono-code text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-100 sm:block"
            >
              Signals
            </Link>
            <Link
              href="/protection"
              className="hidden rounded-lg px-3 py-1.5 font-mono-code text-xs font-semibold uppercase tracking-wider text-zinc-400 transition-colors hover:text-zinc-100 sm:block"
            >
              Protection
            </Link>
            <Link
              href="/dashboard"
              className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3.5 py-1.5 font-mono-code text-xs font-bold uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-950/60"
            >
              Live agent →
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="mx-auto flex min-h-[calc(100svh-57px)] max-w-6xl flex-col justify-center gap-10 px-5 pb-10 pt-14 sm:px-8">
          <div className="max-w-3xl space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-3 py-1 backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="font-mono-code text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                Live on Base mainnet
              </span>
            </div>

            <h1 className="animate-riseIn font-mono-code text-5xl font-black leading-[0.95] tracking-tight text-white sm:text-7xl lg:text-8xl">
              CRASH
              <br />
              INSURANCE
              <br />
              <span className="text-emerald-400">THAT WAKES UP</span>
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-zinc-300 sm:text-lg">
              News breaks in seconds. Price oracles update in minutes. Your portfolio sits
              defenceless in between — and holding protection continuously costs more than
              the position earns.
            </p>

            <p className="max-w-xl text-base leading-relaxed text-zinc-400">
              NutShell watches the wires, checks every claim against the chain itself, and
              only when three independent AI models agree it is real does it buy you a real
              protective put — funded from yield, never from principal.
            </p>

            {/* The anchoring number. Measured on the live book, PRD §1.3. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-[#1e2433] bg-[#080c14]/70 px-5 py-4 backdrop-blur-xl">
              <div>
                <div className="font-mono-code text-3xl font-black text-white">$2.15</div>
                <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
                  premium paid
                </div>
              </div>
              <div className="text-2xl text-zinc-700">→</div>
              <div>
                <div className="font-mono-code text-3xl font-black text-emerald-400">$2,443</div>
                <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
                  downside covered
                </div>
              </div>
              <div className="hidden h-10 w-px bg-[#1e2433] sm:block" />
              <p className="max-w-[15rem] text-[11px] leading-relaxed text-zinc-400">
                0.09% of notional for real protection. The reason nobody hedges this way is
                that you cannot afford to hold it always. A trustworthy trigger changes the
                arithmetic.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={scrollToVerify}
                className="cursor-pointer rounded-xl bg-emerald-500 px-6 py-3 font-mono-code text-sm font-black text-zinc-950 shadow-[0_0_28px_rgba(16,185,129,0.35)] transition-all hover:bg-emerald-400 active:scale-95"
              >
                VERIFY A CLAIM YOURSELF
              </button>
              <Link
                href="/dashboard"
                className="rounded-xl border border-[#2d3748] px-6 py-3 font-mono-code text-sm font-bold text-zinc-300 backdrop-blur-sm transition-colors hover:border-zinc-500 hover:text-white"
              >
                Watch the agent work
              </Link>
            </div>
          </div>

          <ProofStrip />
        </section>

        {/* ── Verify ────────────────────────────────────────────────────── */}
        <section
          ref={verifyRef}
          id="verify"
          className="mx-auto max-w-4xl scroll-mt-16 px-5 pb-16 pt-4 sm:px-8"
        >
          <div className="mb-8 space-y-3 text-center">
            <div className="font-mono-code text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-400">
              The truth engine, open to anyone
            </div>
            <h2 className="font-mono-code text-3xl font-black tracking-tight text-white sm:text-4xl">
              Don&rsquo;t take our word for it
            </h2>
            <p className="mx-auto max-w-xl text-sm leading-relaxed text-zinc-400">
              Paste anything you have seen claimed about a DeFi protocol. Three models on
              the Gonka network will score it in front of you, each showing its own verdict
              and its own request id. This is the same engine that decides whether the agent
              spends money.
            </p>
          </div>

          <VerifyConsole />
        </section>

        {/* ── How ───────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="mb-10 space-y-3">
            <div className="font-mono-code text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-400">
              Six stages, one correlation id
            </div>
            <h2 className="font-mono-code text-3xl font-black tracking-tight text-white sm:text-4xl">
              From a headline to a hedge
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
              Every stage writes its result before the next one starts, and all six are
              threaded by a single id — so any position the agent holds can be traced back
              to the exact sentence and the exact reasoning that bought it.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STAGES.map((s) => (
              <div
                key={s.num}
                className="rounded-2xl border border-[#1e2433] bg-[#0a0f18]/70 p-5 backdrop-blur-sm transition-colors hover:border-[#2d3748]"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono-code text-xs font-black text-emerald-500">
                    {s.num}
                  </span>
                  <span className="font-mono-code text-sm font-bold uppercase tracking-wider text-white">
                    {s.name}
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{s.line}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/signals"
              className="rounded-xl border border-[#2d3748] px-5 py-2.5 font-mono-code text-xs font-bold text-zinc-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
            >
              See what it screened today →
            </Link>
            <Link
              href="/protection"
              className="rounded-xl border border-[#2d3748] px-5 py-2.5 font-mono-code text-xs font-bold text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
            >
              See what it is protecting →
            </Link>
          </div>
        </section>

        {/* ── Security ──────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
          <div className="rounded-3xl border border-[#1e2433] bg-[#0a0f18]/70 p-6 backdrop-blur-sm sm:p-8">
            <h2 className="font-mono-code text-lg font-black tracking-tight text-white">
              What the agent is allowed to do
            </h2>
            <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-zinc-400">
              A policy-bounded burner agent, not a wallet with your keys in it. The blast
              radius is the premium budget and nothing else.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["One action type", "Buy a protective put. No withdraw, no transfer, no collateral movement."],
                ["One contract", "The Thetanuts OptionBook, allowlisted. Nothing else is reachable."],
                ["Exact approvals", "Per trade, to the cent. Never an unlimited allowance."],
                ["Server-side caps", "A hard ceiling per trade and a daily cap, both enforced before signing."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-xl border border-[#1e2433] bg-[#05070b] p-4">
                  <div className="font-mono-code text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                    {title}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#1e2433] bg-[#05070b]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 sm:px-8">
          <div className="font-mono-code text-[10px] text-zinc-600">
            NutShell · Autonomous crisis detection and protective hedging · Base mainnet
            (8453)
          </div>
          <div className="flex flex-wrap gap-4 font-mono-code text-[10px]">
            <Link href="/dashboard" className="text-zinc-500 transition-colors hover:text-zinc-300">
              Live agent
            </Link>
            <Link href="/signals" className="text-zinc-500 transition-colors hover:text-zinc-300">
              Signals
            </Link>
            <Link href="/protection" className="text-zinc-500 transition-colors hover:text-zinc-300">
              Protection
            </Link>
            <Link href="/control" className="text-zinc-500 transition-colors hover:text-zinc-300">
              Console
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
