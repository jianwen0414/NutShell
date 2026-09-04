import { describe, expect, it } from "vitest";
import { sameEvent, triage } from "../lib/triage";
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

describe("sameEvent", () => {
  it("matches one incident written up by different publishers", () => {
    expect(
      sameEvent(
        "Morpho on Base halted after $23M drained via oracle manipulation",
        "Base lender Morpho drained of $23M in oracle manipulation attack",
      ),
    ).toBe(true);
  });

  it("matches a terse headline against a verbose one", () => {
    // Scored against the smaller set, so a short headline fully contained in a
    // long one counts as the same event rather than scoring low on Jaccard.
    expect(
      sameEvent(
        "Aerodrome pool drained",
        "Aerodrome liquidity pool drained by attacker in early morning exploit on Base",
      ),
    ).toBe(true);
  });

  it("separates two different incidents that share vocabulary", () => {
    expect(
      sameEvent(
        "Morpho on Base drained of $23M in exploit",
        "Curve pool on Ethereum drained of $8M in exploit",
      ),
    ).toBe(false);
  });

  it("separates two incidents at the same protocol on different days", () => {
    expect(
      sameEvent(
        "Aerodrome pool drained in oracle attack",
        "Aerodrome announces governance vote on fee structure",
      ),
    ).toBe(false);
  });

  it("does not match on stopwords alone", () => {
    expect(sameEvent("The report after the new says", "A report for the new says")).toBe(false);
  });

  it("handles an empty or punctuation only headline without matching", () => {
    expect(sameEvent("", "Morpho drained")).toBe(false);
    expect(sameEvent("...", "Morpho drained")).toBe(false);
  });
});

describe("triage and price direction", () => {
  it("drops a rally headline even when it names liquidations", () => {
    // Liquidations are heaviest when the market moves hard, in either
    // direction, so the word alone cannot tell a crash from a rally.
    const v = triage(
      item({ title: "Bitcoin Spikes Above $82K After Heavy Short Liquidations" }),
      NOW,
    );

    expect(v.keep).toBe(false);
    expect(v.reason).toMatch(/price rise/i);
  });

  it("still keeps a fall described with the same vocabulary", () => {
    const v = triage(
      item({ title: "Bitcoin plunged below $60K as long liquidations cascaded" }),
      NOW,
    );

    expect(v.keep).toBe(true);
    expect(v.asset).toBe("BTC");
  });

  it("does not let a rally word rescue an item that fails an earlier gate", () => {
    const v = triage(item({ title: "Ethereum climbs on ETF inflows" }), NOW);
    expect(v.keep).toBe(false);
  });
});

describe("triage maps the asset from the headline", () => {
  it("drops a story whose asset appears only in the body", () => {
    // Measured case: a lawsuit about Tether freezing USDT, where "Ethereum"
    // appears once describing which addresses held it. Hedging ETH over that
    // would be a position taken on scenery.
    const v = triage(
      item({
        title: "Tether Froze $42.4 Million Three Months Before A Seizure Warrant",
        summary:
          "Two Thai businessmen are suing Tether over 42,417,785 USDT blacklisted across 10 Ethereum addresses.",
      }),
      NOW,
    );

    expect(v.keep).toBe(false);
    expect(v.asset).toBeNull();
    expect(v.reason).toMatch(/headline names no asset/i);
  });

  it("keeps a story whose asset is in the headline", () => {
    const v = triage(
      item({
        title: "Ethereum bridge drained in $41M exploit",
        summary: "The attacker moved funds across seven transactions.",
      }),
      NOW,
    );

    expect(v.keep).toBe(true);
    expect(v.asset).toBe("ETH");
  });

  it("still finds threat vocabulary in the body, only the asset is headline bound", () => {
    // The threat gate reads title and summary together on purpose. Only the
    // asset decision narrowed, and the protocol named in the headline is
    // enough to resolve one.
    const v = triage(
      item({
        title: "Aerodrome incident under investigation",
        summary: "The pool was drained of roughly 5,200 WETH before trading halted.",
      }),
      NOW,
    );

    expect(v.matched).toContain("drained");
    expect(v.asset).toBe("ETH");
    expect(v.mappingRule).toBe("CONTAGION");
    expect(v.keep).toBe(true);
  });
});
