import { Navigation } from "@/components/navigation";
import { DashboardHero } from "@/components/dashboard-hero";
import { ThreatFeed } from "@/components/threat-feed";

export default function DashboardPage() {
  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-[1560px] px-4 sm:px-6 lg:px-10 py-8 space-y-8">
        {/* Flagship Live Investigation Hero */}
        <DashboardHero />

        {/* Compact Recent Signals Feed */}
        <ThreatFeed />

        {/* Clean System Status Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-zinc-800/50 text-[11px] font-mono-code text-zinc-500">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              Base RPC <strong className="text-zinc-400">Healthy (12ms)</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              Gonka AI Triad <strong className="text-zinc-400">Connected</strong>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              Thetanuts OptionBook <strong className="text-zinc-400">Settled</strong>
            </span>
          </div>
          <div>NutShell Autonomous Sentinel • Base Mainnet</div>
        </footer>
      </main>
    </>
  );
}
