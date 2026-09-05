import { beforeEach, describe, expect, it } from "vitest";
import {
  ingestHistory,
  seedFreshnessGate,
  seedIngest,
  type IngestedItem,
} from "../lib/ingest";

/**
 * The screening history is written by two producers — the boot-time corpus and
 * the poller — and everything downstream reads a window off the front of it.
 *
 * Insertion order used to stand in for recency, and it was wrong the moment
 * both producers were live: the seeded corpus went down first, the poller
 * unshifted several hundred live headlines on top, and the only records
 * carrying a verification ended up at index 274 of 288. A 120-item window
 * contained none of them, so not one headline on `/signals` was clickable.
 *
 * These cover the two properties that has to hold: order by publication time,
 * and never evict a record that cost real inference.
 */

const item = (
  id: string,
  publishedAt: string,
  extra: Partial<IngestedItem> = {},
): IngestedItem => ({
  id,
  title: `Headline ${id}`,
  summary: "",
  url: `https://example.test/${id}`,
  publishedAt,
  sourceId: "test",
  sourceName: "Test Feed",
  ingestedAt: new Date().toISOString(),
  verdict: { keep: false, reason: "test" } as IngestedItem["verdict"],
  ...extra,
});

beforeEach(() => {
  // The store hangs off globalThis so it survives Next's hot reload. Tests
  // need it clean between cases.
  (globalThis as { __nutshellIngest?: unknown }).__nutshellIngest = undefined;
});

describe("ingest history ordering", () => {
  it("returns newest published first, whatever order things were written in", () => {
    seedIngest([
      item("old", "2026-01-14T16:38:32.000Z"),
      item("newest", "2026-09-05T02:05:00.000Z"),
      item("middle", "2026-09-04T22:05:12.000Z"),
    ]);

    expect(ingestHistory(10).map((i) => i.id)).toEqual(["newest", "middle", "old"]);
  });

  it("puts a recent seeded record ahead of an older live one", () => {
    // The exact shape of the bug: a worked corpus item published 90 minutes
    // ago, written first, against a back-catalogue headline from January.
    seedIngest([item("worked", "2026-09-05T01:00:00.000Z", { jobId: "nsh_abc" })]);
    seedIngest([item("backlog", "2026-01-20T18:12:06.000Z")]);

    expect(ingestHistory(10)[0].id).toBe("worked");
  });

  it("keeps every record that reached a job when the history overflows", () => {
    // One verified record, published long enough ago that a plain trim would
    // drop it, plus more than MAX_HISTORY of fresher noise on top.
    seedIngest([item("verified", "2020-01-01T00:00:00.000Z", { jobId: "nsh_keep" })]);
    seedIngest(
      Array.from({ length: 400 }, (_, n) =>
        item(`noise-${n}`, new Date(Date.now() - n * 60_000).toISOString()),
      ),
    );

    const all = ingestHistory(1000);
    expect(all.length).toBe(300);
    expect(all.some((i) => i.id === "verified")).toBe(true);
  });

  it("drops the stalest unverified records rather than the newest", () => {
    seedIngest(
      Array.from({ length: 400 }, (_, n) =>
        item(`n-${n}`, new Date(Date.UTC(2026, 0, 1) + (400 - n) * 60_000).toISOString()),
      ),
    );

    const all = ingestHistory(1000);
    expect(all.length).toBe(300);
    // n-0 is the newest by construction; n-399 the oldest.
    expect(all[0].id).toBe("n-0");
    expect(all.some((i) => i.id === "n-399")).toBe(false);
  });
});

describe("seeding freshness window", () => {
  // The first poll deliberately records the back catalogue without paying for
  // inference on it. The gate is what stops that rule from also throwing away
  // the story that broke ten minutes before the server came up — which is why
  // the automated path could run 142 polls and start nothing.
  const NOW = Date.parse("2026-09-05T03:00:00.000Z");
  const gate = seedFreshnessGate(NOW);

  it("verifies a headline published minutes ago", () => {
    expect(gate("2026-09-05T02:50:00.000Z")).toBe(true);
  });

  it("declines the back catalogue", () => {
    expect(gate("2026-09-04T21:00:00.000Z")).toBe(false);
    expect(gate("2026-01-20T18:12:06.000Z")).toBe(false);
  });

  it("holds at the boundary rather than near it", () => {
    // Default window is 90 minutes.
    expect(gate(new Date(NOW - 90 * 60_000).toISOString())).toBe(true);
    expect(gate(new Date(NOW - 90 * 60_000 - 1).toISOString())).toBe(false);
  });

  it("treats an unparseable date as back catalogue, not as fresh", () => {
    expect(gate("not a date")).toBe(false);
    expect(gate("")).toBe(false);
  });
});
