/**
 * Stage 01 — where alerts actually come from.
 *
 * Four public crypto news feeds, polled on a timer. No API key, no signup, no
 * rate limit worth worrying about: RSS is a twenty year old open format and
 * every one of these publishers still serves it.
 *
 * X was the obvious first choice and is not viable. Reading the firehose costs
 * $200 a month for the lowest paid tier, and the free tier cannot search. The
 * ingestion path here is source agnostic, so a social feed can be added later
 * by writing one adapter that returns FeedItem; nothing downstream changes.
 *
 * Nothing in this file decides whether an item matters. It fetches and it
 * normalises. Triage is a separate module so it can be tested without network.
 */

/** One publisher. `url` is the feed, `name` is what the UI shows. */
export interface FeedSource {
  id: string;
  name: string;
  url: string;
}

/**
 * Confirmed live on 3 Sep 2026. CoinDesk and Blockworks both answer 308 to a
 * plain GET and are deliberately absent rather than left in to fail forever.
 */
export const FEED_SOURCES: FeedSource[] = [
  { id: "cointelegraph", name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { id: "theblock", name: "The Block", url: "https://www.theblock.co/rss.xml" },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed" },
  { id: "cryptoslate", name: "CryptoSlate", url: "https://cryptoslate.com/feed/" },
];

/** A published article, normalised across publishers. */
export interface FeedItem {
  /** Stable across polls. The publisher's guid, falling back to the link. */
  id: string;
  title: string;
  /** Summary with markup and entities stripped. May be empty. */
  summary: string;
  url: string;
  publishedAt: string;
  sourceId: string;
  sourceName: string;
}

const FETCH_TIMEOUT_MS = Number(process.env.FEED_TIMEOUT_MS ?? 12_000);

/**
 * Some publishers serve a default deny to unrecognised clients. A browser
 * string is enough; none of these feeds want anything else.
 */
const HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; NutShell/1.0; +https://github.com/jianwen0414/NutShell)",
  accept: "application/rss+xml, application/xml, text/xml, */*",
};

// ── XML ───────────────────────────────────────────────────────────────────
//
// Hand written rather than pulled from a parser package. These four feeds are
// flat RSS 2.0: a list of <item>, each holding text children. A dependency
// would buy namespace handling and streaming that nothing here needs.

/** Contents of the first <tag> inside a block, CDATA unwrapped. */
function tag(block: string, name: string): string {
  // String.raw so the regex escapes survive being written into a template
  // literal. Plain interpolation turns \s into s and the pattern silently
  // matches nothing, which is a very quiet way to return an empty feed.
  const m = new RegExp(
    String.raw`<${name}(?:\s[^>]*)?>([\s\S]*?)</${name}>`,
    "i",
  ).exec(block);
  if (!m) return "";
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'", mdash: "-", ndash: "-", hellip: "...",
};

/**
 * Entities to characters.
 *
 * Curly quotes and dashes are folded to ASCII on the way through. The text
 * ends up in a model prompt and in a hash used for deduplication, and a
 * publisher silently switching ' for U+2019 should not read as a new article.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

/** Typographic characters folded to ASCII. Keyed by character, not by name. */
const FOLD: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "–": "-", "—": "-", "…": "...", " ": " ",
};

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  const ch = String.fromCodePoint(code);
  return FOLD[ch] ?? ch;
}

/** Markup out, entities decoded, whitespace collapsed. */
export function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** RSS date to ISO. Falls back to now, so a malformed date cannot drop an item. */
function toIso(raw: string): string {
  const t = Date.parse(raw);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

/**
 * Parse one feed body.
 *
 * Exported for the tests, which run it over saved fixtures. An item with no
 * title or no link is dropped: both are needed downstream, and a half item is
 * worse than a missing one.
 */
export function parseFeed(xml: string, source: FeedSource): FeedItem[] {
  const items: FeedItem[] = [];

  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const title = stripHtml(tag(block, "title"));
    const url = decodeEntities(tag(block, "link"));
    if (!title || !url) continue;

    items.push({
      id: tag(block, "guid") || url,
      title,
      summary: stripHtml(tag(block, "description")).slice(0, 600),
      url,
      publishedAt: toIso(tag(block, "pubDate") || tag(block, "dc:date")),
      sourceId: source.id,
      sourceName: source.name,
    });
  }

  return items;
}

// ── Fetching ──────────────────────────────────────────────────────────────

export interface FeedResult {
  source: FeedSource;
  items: FeedItem[];
  /** Set when the fetch failed. The poller logs it and keeps the other three. */
  error?: string;
  latencyMs: number;
}

/**
 * Fetch one feed.
 *
 * Never throws. A publisher being down is an ordinary Tuesday and must not
 * take the ingestion loop with it.
 */
export async function fetchFeed(source: FeedSource): Promise<FeedResult> {
  const started = Date.now();
  try {
    const res = await fetch(source.url, {
      headers: HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { source, items: [], error: `HTTP ${res.status}`, latencyMs: Date.now() - started };
    }
    const items = parseFeed(await res.text(), source);
    return { source, items, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      source,
      items: [],
      error: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - started,
    };
  }
}

/**
 * Every feed at once, newest first.
 *
 * Parallel because four sequential fetches would put the slowest publisher in
 * series with the other three for no reason.
 */
export async function fetchAllFeeds(
  sources: FeedSource[] = FEED_SOURCES,
): Promise<{ items: FeedItem[]; results: FeedResult[] }> {
  const results = await Promise.all(sources.map(fetchFeed));
  const items = results
    .flatMap((r) => r.items)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { items, results };
}
