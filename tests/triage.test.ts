import { describe, expect, it } from "vitest";
import { triage } from "../lib/triage";
import type { FeedItem } from "../lib/feeds";

const NOW = new Date("2026-09-03T12:00:00.000Z");

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  id: "1",
  title: "Placeholder",
  summary: "",
  url: "https://example.test/a",
  publishedAt: "2026-09-03T11:30:00.000Z",
  sourceId: "test",
  sourceName: "Test Feed",
  ...over,
});

describe("triage keeps", () => {
  it("a reported exploit that names a hedgeable asset", () => {
    const v = triage(
      item({
        title: "Ethereum bridge drained in $41M exploit",
        summary: "The attacker moved funds across seven transactions.",
      }),
      NOW,
    );

    expect(v.keep).toBe(true);
    expect(v.asset).toBe("ETH");
    expect(v.matched).toContain("exploit");
  });

  it("an incident on an ecosystem that settles on a listed asset", () => {
    const v = triage(item({ title: "Aerodrome pool drained on Base" }), NOW);

    expect(v.keep).toBe(true);
    expect(v.asset).toBe("ETH");
    expect(v.mappingRule).toBe("CONTAGION");
  });

  it("a halt, which is distress even without the word exploit", () => {
    const v = triage(item({ title: "Solana validators halted after consensus bug" }), NOW);

    expect(v.keep).toBe(true);
    expect(v.asset).toBe("SOL");
  });
});

describe("triage rejects", () => {
  it("ordinary news with no threat vocabulary", () => {
    const v = triage(item({ title: "Wyoming adds Chainlink reserve verification" }), NOW);

    expect(v.keep).toBe(false);
    expect(v.matched).toEqual([]);
  });

  it("a question headline, which is commentary rather than a report", () => {
    const v = triage(item({ title: "Is Bitcoin about to crash?" }), NOW);

    expect(v.keep).toBe(false);
    expect(v.reason).toMatch(/question/i);
  });

  it("analysis framing even when the threat words are present", () => {
    const v = triage(
      item({ title: "What a Bitcoin exchange hack would mean for the market" }),
      NOW,
    );

    expect(v.keep).toBe(false);
    expect(v.reason).toMatch(/commentary/i);
  });

  it("a real incident that names nothing this system can hedge", () => {
    // Correct behaviour, not a gap: there is no TAC option to buy, so
    // verifying it could only ever end in an abstention.
    const v = triage(item({ title: "TAC blockchain frozen after massive exploit" }), NOW);

    expect(v.keep).toBe(false);
    expect(v.matched.length).toBeGreaterThan(0);
    expect(v.asset).toBeNull();
  });

  it("a security breach outside crypto", () => {
    const v = triage(item({ title: "Dropbox breach exposes user accounts" }), NOW);
    expect(v.keep).toBe(false);
  });

  it("stale news, however alarming", () => {
    const v = triage(
      item({
        title: "Ethereum bridge drained in $41M exploit",
        publishedAt: "2026-08-25T00:00:00.000Z",
      }),
      NOW,
    );

    expect(v.keep).toBe(false);
    expect(v.reason).toMatch(/older than/i);
  });
});

describe("triage word boundaries", () => {
  it("does not read hackathon as a hack", () => {
    const v = triage(item({ title: "Ethereum hackathon draws record entries" }), NOW);

    expect(v.matched).not.toContain("hack");
    expect(v.keep).toBe(false);
  });

  it("does not read defaulted settings as a credit default", () => {
    const v = triage(item({ title: "Ethereum wallet defaulted to dark mode" }), NOW);
    expect(v.matched).not.toContain("default");
  });
});

describe("triage reporting", () => {
  it("always explains itself, kept or not", () => {
    const kept = triage(item({ title: "Ethereum bridge drained in exploit" }), NOW);
    const dropped = triage(item({ title: "G20 members tout clear pathways" }), NOW);

    expect(kept.reason.length).toBeGreaterThan(0);
    expect(dropped.reason.length).toBeGreaterThan(0);
  });
});
