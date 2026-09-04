import { Navigation } from "@/components/navigation";
import { AgentConsole } from "@/components/dashboard/agent-console";
import { RecentSignals } from "@/components/dashboard/recent-signals";
import { SystemStatusBar } from "@/components/dashboard/system-status-bar";

/**
 * The agent, working.
 *
 * PRD §13.1 calls this the dashboard and puts Verify at `/`. It reads as a
 * viewing surface first and a control panel second: everything an operator can
 * do from here is folded behind a disclosure, so a visitor who follows "watch
 * the agent work" from the landing page is not handed a bypass switch.
 */
export default function DashboardPage() {
  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-[1560px] space-y-8 px-4 py-8 sm:px-6 lg:px-10">
        <AgentConsole />
        <RecentSignals />
        <SystemStatusBar />
      </main>
    </>
  );
}
