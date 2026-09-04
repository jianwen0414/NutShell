import { mapEventToAsset, type TradeableAsset } from "./event-mapping";
import type { FeedItem } from "./feeds";
import type { MappingRule } from "@/types";

/**
 * Stage 01 — deciding which headlines are worth paying for.
 *
 * The four feeds return roughly a hundred articles. Sending all of them to the
 * verification layer would be three hundred inference calls a poll, almost all
 * of them spent establishing that a G20 communique is not a threat to anyone's
 * position. On a normal day this module keeps none of them, and that is the
 * correct answer rather than a failure.
 *
 * Deliberately keyword driven. A model deciding what is worth sending to the
 * models is circular, costs the thing it is meant to save, and puts a
 * judgement call somewhere nobody can read it. Every rule below can be
 * explained out loud and argued with, which is the property that matters when
 * somebody asks why a particular headline was ignored.
 *
 * Tuned to be generous. A false positive costs one verification round, which
 * the layer will reject on its own. A false negative is a threat the system
 * never saw at all, so the gates favour letting things through.
 */

/** Words that describe an event that already happened, grouped by kind. */
const THREAT_TERMS: Record<string, string[]> = {
  theft: [
    "exploit", "exploited", "exploits", "hack", "hacked", "hacker", "hackers",
    "drained", "drain", "stolen", "steal", "theft", "breach", "breached",
    "attack", "attacked", "attacker", "compromised", "siphoned", "looted",
    "rug pull", "rugpull", "rugged",
  ],
  halt: [
    "halted", "halts", "halt", "paused", "pauses", "frozen", "freeze", "froze",
    "suspended", "suspends", "shut down", "shutdown", "offline", "outage",
    "withdrawals disabled", "trading disabled",
  ],
  solvency: [
    "insolvent", "insolvency", "bankrupt", "bankruptcy", "collapse", "collapsed",
    "default", "defaulted", "liquidated", "liquidation", "liquidations",
    "bank run", "bailout", "restructuring",
  ],
  peg: ["depeg", "depegged", "de-peg", "depegging", "lost its peg", "off peg"],
  vulnerability: [
    "vulnerability", "critical bug", "backdoor", "malicious", "poisoned",
    "zero-day", "zero day", "emergency patch",
  ],
  crash: ["crash", "crashed", "plunge", "plunged", "plummet", "plummeted", "wipeout"],
};

/**
 * Framing that marks a headline as commentary rather than an event.
 *
 * The distinction this stage has to draw is between "a bridge was drained" and
 * "here is what a drained bridge would mean". Both contain the same threat
 * vocabulary; only one is an event to hedge against. Analysis pieces are the
 * single largest category in these feeds, so this gate does most of the work.
 */
const SPECULATION_TERMS = [
  "could", "would", "might", "may", "if", "what happens", "what to know",
  "here's why", "heres why", "here's how", "explained", "explainer",
  "analyst", "analysts", "prediction", "predicts", "forecast", "outlook",
  "opinion", "podcast", "interview", "op-ed", "price target", "poised",
  "set to", "eyes", "expects", "expected to", "guide", "how to", "review",
  "vs", "versus", "history of", "anniversary", "recap", "weekly", "roundup",
];

/**
 * Words that mark a price move upward.
 *
 * Measured, and the reason this gate exists: "Bitcoin Spikes Above $82K After
 * Heavy Short Liquidations" passed every other gate, because `liquidations`
 * is in the solvency list and BTC is hedgeable. Liquidations happen in both
 * directions and are heaviest exactly when the market is moving hard, so the
 * threat vocabulary alone cannot tell a crash from a rally.
 *
 * Nobody buys downside protection because an asset went up, so a headline
 * framed as a rise is not an event this system acts on.
 */
const RALLY_TERMS = [
  "spikes", "spike", "surges", "surge", "soars", "soar", "rallies", "rally",
  "jumps", "jump", "climbs", "climb", "rises", "rise", "gains", "gain",
  "tops", "breaks above", "above", "high", "highs", "record", "bullish",
  "recovers", "rebound", "rebounds", "up",
];

/** Nothing older than this is actionable. Feeds carry a long tail. */
const MAX_AGE_HOURS = Number(process.env.TRIAGE_MAX_AGE_HOURS ?? 24);

/**
 * Match on word boundaries.
 *
 * Substring matching turns "hackathon" into a security incident and
 * "defaulted to dark mode" into a credit event. Multi-word terms are matched
 * as phrases, with the same boundary rule at each end.
 */
function mentions(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return new RegExp(String.raw`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack);
}

function matchedTerms(text: string): string[] {
  const hits: string[] = [];
  for (const terms of Object.values(THREAT_TERMS)) {
    for (const term of terms) {
      if (mentions(text, term)) hits.push(term);
    }
  }
  return hits;
}

/**
 * Words carrying no identifying weight. Kept deliberately short: this list
 * exists to stop two unrelated headlines matching on "the" and "after", not to
 * do real linguistics.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "for", "of", "to", "in", "on", "at",
  "by", "from", "with", "as", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "these", "those", "after", "before", "over", "amid",
  "into", "out", "up", "down", "new", "says", "said", "report", "reports",
]);

/** Identifying words in a headline: lowercase, punctuation gone, stopwords out. */
export function significantTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9$\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Do two headlines describe the same event?
 *
 * One exploit is written up by every publisher on the list, each with its own
 * wording, so a hash of the title makes eight distinct clusters out of one
 * incident and pays for eight verifications of it. Overlap of the identifying
 * words is a cheap way to notice, and it is checked before any model is called
 * rather than after.
 *
 * Scored against the smaller headline, not the union. A terse headline and a
 * verbose one about the same drain share every word the terse one has, and
 * Jaccard would score that pairing low precisely when it matters most.
 */
export function sameEvent(a: string, b: string, threshold = 0.6): boolean {
  const [ta, tb] = [significantTokens(a), significantTokens(b)];
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size) >= threshold;
}

export interface TriageVerdict {
  keep: boolean;
  /** Why, in a sentence. Logged for every item so the filter is auditable. */
  reason: string;
  /** Threat vocabulary found, empty when none. */
  matched: string[];
  asset: TradeableAsset | null;
  mappingRule: MappingRule;
}

/**
 * Should this headline reach the verification layer?
 *
 * Four gates, cheapest first, each one able to reject on its own:
 *
 *   1. age        stale news is not a live threat
 *   2. threat     the text has to describe something bad happening
 *   3. framing    commentary about a bad thing is not the bad thing
 *   4. asset      an unhedgeable subject cannot produce a position
 *
 * Gate 4 passes severity 1 rather than a real severity on purpose. The mapper
 * falls back to a proxy hedge for anything systemic enough, which is right at
 * decision time and useless as a filter: at severity 5 every headline resolves
 * to ETH and the gate stops rejecting anything. A low severity restricts it to
 * naming an asset or a known ecosystem outright.
 */
export function triage(item: FeedItem, now: Date = new Date()): TriageVerdict {
  const title = item.title;
  const text = `${item.title}. ${item.summary}`;

  const empty = { matched: [] as string[], asset: null, mappingRule: "ABSTAIN" as MappingRule };

  const ageHours = (now.getTime() - Date.parse(item.publishedAt)) / 3_600_000;
  if (ageHours > MAX_AGE_HOURS) {
    return { keep: false, reason: `Published ${Math.round(ageHours)}h ago, older than ${MAX_AGE_HOURS}h.`, ...empty };
  }

  const matched = matchedTerms(text);
  if (matched.length === 0) {
    return { keep: false, reason: "No threat vocabulary in the title or summary.", ...empty };
  }

  // Framing is judged on the title alone. A summary routinely restates a real
  // incident in hedged language, and rejecting on that would drop the events
  // this stage exists to catch.
  if (title.trim().endsWith("?")) {
    return { keep: false, reason: "Headline is a question, which reads as commentary.", matched, asset: null, mappingRule: "ABSTAIN" };
  }
  const speculative = SPECULATION_TERMS.find((t) => mentions(title, t));
  if (speculative) {
    return {
      keep: false,
      reason: `Headline is framed as commentary ("${speculative}"), not a reported event.`,
      matched,
      asset: null,
      mappingRule: "ABSTAIN",
    };
  }

  // Judged on the title, like the framing gate above, and after it: a rally
  // headline is a fact about direction, not about wording.
  const rally = RALLY_TERMS.find((t) => mentions(title, t));
  if (rally) {
    return {
      keep: false,
      reason: `Headline reports a price rise ("${rally}"), which is not a threat to hedge.`,
      matched,
      asset: null,
      mappingRule: "ABSTAIN",
    };
  }

  // Mapped from the title, not the whole text.
  //
  // Measured, and the reason this is not the full text: "Tether Froze $42.4
  // Million Three Months Before A Seizure Warrant" resolved to ETH because its
  // summary described the USDT as sitting across "10 Ethereum addresses". The
  // title alone maps to nothing, which is the honest answer. The story is a
  // lawsuit about a stablecoin issuer, and hedging ETH over it would have been
  // a trade placed on scenery.
  //
  // A headline is an editor's statement of what the story is about. An asset
  // named only in the body is usually incidental, and the cost of that error
  // is a real position in the wrong instrument.
  const mapping = mapEventToAsset(title, 1);
  if (!mapping.asset) {
    return {
      keep: false,
      reason: "Headline names no asset or ecosystem this system can hedge.",
      matched,
      asset: null,
      mappingRule: mapping.rule,
    };
  }

  return {
    keep: true,
    reason: `Reports ${matched.slice(0, 3).join(", ")}; hedgeable via ${mapping.asset} (${mapping.rule}).`,
    matched,
    asset: mapping.asset,
    mappingRule: mapping.rule,
  };
}

/** Triage a batch, keeping the rejections so the UI can show what was screened. */
export function triageAll(
  items: FeedItem[],
  now: Date = new Date(),
): Array<{ item: FeedItem; verdict: TriageVerdict }> {
  return items.map((item) => ({ item, verdict: triage(item, now) }));
}
