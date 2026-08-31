"use client";

interface ThreatEvent {
  id: string;
  sourceName: string;
  sourceType: "ON_CHAIN" | "SOCIAL" | "NEWS";
  timeAgo: string;
  headline: string;
  credibility: string;
  status: "HEDGED" | "REJECTED" | "UNWOUND" | "WATCHING";
  truthScore: number;
}

const RECENT_EVENTS: ThreatEvent[] = [
  {
    id: "evt-01",
    sourceName: "On-Chain Bridge Sensor",
    sourceType: "ON_CHAIN",
    timeAgo: "2m ago",
    headline: "$40.2M Bridge Outflow Spike",
    credibility: "98%",
    status: "HEDGED",
    truthScore: 88,
  },
  {
    id: "evt-02",
    sourceName: "Protocol Update",
    sourceType: "NEWS",
    timeAgo: "15m ago",
    headline: "Whitehat Migration Confirmed",
    credibility: "95%",
    status: "UNWOUND",
    truthScore: 12,
  },
  {
    id: "evt-03",
    sourceName: "Social Firehose",
    sourceType: "SOCIAL",
    timeAgo: "42m ago",
    headline: "USDC Freeze Rumor",
    credibility: "12%",
    status: "REJECTED",
    truthScore: 18,
  },
  {
    id: "evt-04",
    sourceName: "DEX Liquidity Sensor",
    sourceType: "ON_CHAIN",
    timeAgo: "1h ago",
    headline: "Transient 0.8% WETH Pool Slippage",
    credibility: "88%",
    status: "WATCHING",
    truthScore: 42,
  },
];

export function ThreatFeed() {
  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between font-mono-code">
        <span className="font-bold uppercase tracking-wider text-zinc-300 text-sm">
          Recent Signals Telemetry
        </span>
        <span className="text-xs text-zinc-400">Last 4 Background Signals</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800/60 bg-[#090c12] shadow-md">
        <table className="w-full text-left font-mono-code text-sm">
          <thead>
            <tr className="border-b border-zinc-800/80 text-xs uppercase text-zinc-400">
              <th className="px-6 py-3.5">Signal</th>
              <th className="px-6 py-3.5">Source</th>
              <th className="px-6 py-3.5">Confidence</th>
              <th className="px-6 py-3.5">Truth Score</th>
              <th className="px-6 py-3.5 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/40 text-zinc-200">
            {RECENT_EVENTS.map((evt) => (
              <tr key={evt.id} className="hover:bg-zinc-900/50 transition-colors">
                <td className="px-6 py-3.5 font-semibold text-white truncate max-w-sm">
                  {evt.headline}
                </td>
                <td className="px-6 py-3.5 text-zinc-300 text-xs sm:text-sm">
                  {evt.sourceName} <span className="text-zinc-500 font-normal">({evt.timeAgo})</span>
                </td>
                <td className="px-6 py-3.5 text-zinc-300">{evt.credibility}</td>
                <td className="px-6 py-3.5 font-bold text-white text-base">{evt.truthScore}/100</td>
                <td className="px-6 py-3.5 text-right">
                  <span
                    className={`inline-block px-3 py-1 rounded text-xs font-bold ${
                      evt.status === "HEDGED"
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : evt.status === "UNWOUND"
                        ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        : evt.status === "REJECTED"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {evt.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
