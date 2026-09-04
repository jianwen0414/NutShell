import { describe, expect, it } from "vitest";
import { parseFeed, stripHtml, type FeedSource } from "../lib/feeds";

const SOURCE: FeedSource = { id: "test", name: "Test Feed", url: "https://example.test/rss" };

const feed = (items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Chan</title><atom:link href="https://example.test/rss"/>
${items}
</channel></rss>`;

describe("parseFeed", () => {
  it("pulls the fields the pipeline needs out of a plain item", () => {
    const items = parseFeed(
      feed(`<item>
        <title>Bridge drained on Base</title>
        <link>https://example.test/a</link>
        <description>Roughly $41M left the contract.</description>
        <pubDate>Wed, 02 Sep 2026 18:38:18 +0000</pubDate>
        <guid isPermaLink="true">https://example.test/a</guid>
      </item>`),
      SOURCE,
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Bridge drained on Base");
    expect(items[0].url).toBe("https://example.test/a");
    expect(items[0].summary).toBe("Roughly $41M left the contract.");
    expect(items[0].publishedAt).toBe("2026-09-02T18:38:18.000Z");
    expect(items[0].sourceName).toBe("Test Feed");
  });

  it("unwraps CDATA, which every publisher uses for links", () => {
    const items = parseFeed(
      feed(`<item>
        <title><![CDATA[Exploit at dawn]]></title>
        <link><![CDATA[https://example.test/b?utm_source=rss]]></link>
        <description><![CDATA[<p>Markup <b>inside</b> the summary.</p>]]></description>
      </item>`),
      SOURCE,
    );

    expect(items[0].title).toBe("Exploit at dawn");
    expect(items[0].url).toBe("https://example.test/b?utm_source=rss");
    expect(items[0].summary).toBe("Markup inside the summary.");
  });

  it("decodes entities and folds typographic characters to ASCII", () => {
    // The text is hashed for deduplication, so a publisher switching a straight
    // quote for a curly one must not read as a different article.
    const items = parseFeed(
      feed(`<item>
        <title>Tether&#8217;s reserves &amp; the &#8220;peg&#8221;</title>
        <link>https://example.test/c</link>
      </item>`),
      SOURCE,
    );

    expect(items[0].title).toBe(`Tether's reserves & the "peg"`);
  });

  it("drops an item with no title or no link rather than half building one", () => {
    const items = parseFeed(
      feed(`<item><link>https://example.test/d</link></item>
            <item><title>No link here</title></item>
            <item><title>Good</title><link>https://example.test/e</link></item>`),
      SOURCE,
    );

    expect(items.map((i) => i.title)).toEqual(["Good"]);
  });

  it("falls back to the link when the publisher omits a guid", () => {
    const items = parseFeed(
      feed(`<item><title>T</title><link>https://example.test/f</link></item>`),
      SOURCE,
    );
    expect(items[0].id).toBe("https://example.test/f");
  });

  it("returns nothing for a body that is not a feed, instead of throwing", () => {
    expect(parseFeed("<html><body>404</body></html>", SOURCE)).toEqual([]);
    expect(parseFeed("", SOURCE)).toEqual([]);
  });
});

describe("stripHtml", () => {
  it("removes markup and collapses whitespace", () => {
    expect(stripHtml("<p>One</p>\n  <p>Two</p>")).toBe("One Two");
  });

  it("drops script and style bodies rather than inlining their text", () => {
    expect(stripHtml("<script>alert(1)</script>Real text")).toBe("Real text");
    expect(stripHtml("<style>.a{color:red}</style>Real text")).toBe("Real text");
  });
});
