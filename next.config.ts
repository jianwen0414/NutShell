import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Routes moved when the information architecture was rebuilt around the
   * three people who use this: a visitor verifying a claim, an owner checking
   * what they are covered for, and an operator driving the agent.
   *
   * PRD §13.1 puts Verify at `/` and the console at `/dashboard`; the
   * prototype had those inverted. The rest are renames toward what each page
   * is for rather than what it was called while it was being built.
   *
   * These are permanent (308). They exist because Telegram alerts, the README
   * and anything a judge bookmarked all carry the old paths, and a dead link
   * during judging costs more than a redirect table.
   */
  async redirects() {
    return [
      { source: "/feed", destination: "/signals", permanent: true },
      { source: "/portfolio", destination: "/protection", permanent: true },
      // Both of these collapsed into one incident record.
      { source: "/position/:cid", destination: "/incident/:cid", permanent: true },
      { source: "/hedge/:jobId", destination: "/incident/:jobId", permanent: true },
    ];
  },
};

export default nextConfig;
