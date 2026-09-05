import { createHash } from "node:crypto";
import { newCorrelationId } from "./ids";
import { startVerification } from "./runtime";
import { fetchAllFeeds, type FeedItem } from "./feeds";
import { sameEvent, triage, type TriageVerdict } from "./triage";
import { isAgentPaused } from "./control-state";
import type { AlertEvent, AlertSourceType } from "@/types";

/**
 * Stage 01 — the ingestion loop and the record of what it saw.
 *
 * Two jobs. It polls the news feeds on a timer, and it keeps every headline it
 * has considered along with the triage decision, so the dashboard can show
 * screening actually happening rather than a number going up.
 *
 * Holding the rejections is the point. "97 headlines read, 96 rejected, 1
 * verified" is a far better account of the system than "1 alert" is, and it is
 * the only way anybody can check that the filter is sane.
 */

/** A headline the system has looked at, and what it decided. */
export interface IngestedItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  sourceId: string;
  sourceName: string;
  ingestedAt: string;
  verdict: TriageVerdict;
  /** Set only when triage kept it and a verification job was started. */
  jobId?: string;
}

/** Kept in memory, newest first. Enough for the dashboard, not a database. */
const MAX_HISTORY = 300;

/**
 * How fresh a headline has to be to be worth verifying on the very first poll.
 *
 * The seeding pass exists so a boot does not spend real inference re-reading a
 * day of back catalogue. But "everything on the first poll is old news" is not
 * true: a feed read at 09:00 carries whatever broke at 08:55, and refusing to
 * look at it means the automated path cannot demonstrate itself until the next
 * genuinely new story arrives — which, measured over 142 polls, was never.
 *
 * So the seeding pass still declines the back catalogue, and still verifies
 * anything published inside this window, capped so a busy morning cannot turn
 * a server restart into an unbounded inference bill.
 */
const SEED_FRESH_MS = Number(process.env.INGEST_SEED_FRESH_MS ?? 90 * 60_000);
const SEED_MAX_JOBS = Number(process.env.INGEST_SEED_MAX_JOBS ?? 2);

/**
 * Is a headline recent enough that the seeding pass should still verify it?
 *
 * Exported so the window can be tested without a network round trip and a
 * Gonka bill. Takes `now` rather than reading the clock, because a gate that
 * reads the clock cannot be tested at a boundary.
 */
export function seedFreshnessGate(now: number): (publishedAt: string) => boolean {
  const cutoff = now - SEED_FRESH_MS;
  return (publishedAt: string) => {
    const at = Date.parse(publishedAt);
    // An unparseable date is back catalogue as far as this is concerned:
    // NaN >= cutoff is false, but say so rather than leaning on that.
    return Number.isFinite(at) && at >= cutoff;
  };
}

interface IngestState {
  /** Feed ids already handled, so a headline is never verified twice. */
  seen: Set<string>;
  history: IngestedItem[];
  timer: NodeJS.Timeout | null;
  /** Cleared once the first poll has established a baseline. */
  seeding: boolean;
  lastPollAt: string | null;
  lastPollError: string | null;
  polls: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __nutshellIngest: IngestState | undefined;
}

function state(): IngestState {
  globalThis.__nutshellIngest ??= {
    seen: new Set(),
    history: [],
    timer: null,
    seeding: true,
    lastPollAt: null,
    lastPollError: null,
    polls: 0,
  };
  return globalThis.__nutshellIngest;
}

/** Stable across restarts, unlike a correlation id. Used for clustering. */
export function clusterKeyFor(text: string): string {
  return createHash("sha256").update(text.toLowerCase().trim()).digest("hex").slice(0, 16);
}

export function alreadySeen(id: string): boolean {
  return state().seen.has(id);
}

/**
 * Order by publication time and trim, protecting anything that reached a job.
 *
 * Insertion order used to stand in for recency, and it stopped being a good
 * proxy the moment two producers wrote to the same list. The worked corpus is
 * laid down at boot; the poller then unshifts every live headline on top of
 * it, so a story published 90 minutes ago sat at index 274 of 288 behind a
 * back catalogue reaching back to January. Everything downstream reads a
 * window off the front of this list, so the only records carrying a
 * verification — the ones worth clicking — were the only ones never in it.
 *
 * The trim protects items with a `jobId` for the same reason: those cost real
 * inference and are the audit trail. Discarding them to make room for another
 * dismissed headline would delete evidence to keep noise.
 */
function reorder(s: IngestState): void {
  s.history.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  if (s.history.length <= MAX_HISTORY) return;

  const keep: IngestedItem[] = [];
  const spill: IngestedItem[] = [];
  for (const item of s.history) (item.jobId ? keep : spill).push(item);
  // Verified records first, then as much of the rest as fits, re-sorted.
  s.history = [...keep, ...spill.slice(0, Math.max(0, MAX_HISTORY - keep.length))].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

function remember(item: IngestedItem): void {
  const s = state();
  s.seen.add(item.id);
  s.history.unshift(item);
  reorder(s);
}

/**
 * Push one item through triage and, if it survives, into the pipeline.
 *
 * `startJobs` is false during the first poll. A feed's back catalogue is a
 * day of old news, and verifying all of it at startup would spend real
 * inference establishing that yesterday already happened. Seeding records the
 * headlines and the decisions, so the dashboard has content immediately, and
 * starts jobs only for what arrives afterwards.
 */
export async function ingestItem(
  item: FeedItem,
  opts: { startJobs?: boolean; sourceType?: AlertSourceType } = {},
): Promise<IngestedItem> {
  const verdict = triage(item);

  // One incident is written up by every publisher on the list. Verifying each
  // retelling separately would pay for the same answer several times over and
  // put several near identical jobs in front of the policy engine, so a
  // headline matching one already verified is recorded and stopped here.
  //
  // Only matches against items that actually reached a job. If the earlier one
  // was screened out or failed to start, this is the first real look at the
  // event rather than a repeat of it.
  if (verdict.keep) {
    const priorEvent = state().history.find(
      (h) => h.jobId && sameEvent(h.title, item.title),
    );
    if (priorEvent) {
      verdict.keep = false;
      verdict.reason = `Same event as "${priorEvent.title.slice(0, 60)}", already verified.`;
    }
  }

  const record: IngestedItem = {
    ...item,
    ingestedAt: new Date().toISOString(),
    verdict,
  };

  if (verdict.keep && opts.startJobs !== false) {
    const text = item.summary ? `${item.title}. ${item.summary}` : item.title;
    const alert: AlertEvent = {
      id: newCorrelationId(),
      source: {
        type: opts.sourceType ?? "NEWS",
        name: item.sourceName,
        url: item.url,
      },
      rawText: text,
      sourceUrl: item.url,
      receivedAt: item.publishedAt,
      clusterKey: clusterKeyFor(item.title),
      metadata: { feedItemId: item.id, triage: verdict.reason },
    };

    // Ingested alerts are trade eligible: the pipeline only excludes
    // USER_PASTE. dryRun stays on unless the operator has turned it off for
    // the whole process, so a live feed cannot spend money by surprise.
    const job = await startVerification(alert, {
      dryRun: process.env.INGEST_LIVE_TRADING !== "true",
    });
    record.jobId = job.jobId;
  }

  remember(record);
  return record;
}

export interface PollResult {
  fetched: number;
  fresh: number;
  kept: number;
  started: number;
  errors: string[];
  seeded: boolean;
  /** The timer fired while the operator had the agent paused, so it did not run. */
  paused?: boolean;
  latencyMs: number;
}

/**
 * One pass over every feed.
 *
 * Never throws. This runs on a timer with nobody watching, and an unhandled
 * rejection in a background interval takes the dev server with it.
 */
export async function pollOnce(opts: { force?: boolean } = {}): Promise<PollResult> {
  const started = Date.now();
  const s = state();
  const seeded = s.seeding;

  // The operator's pause switch stops the timer from working, not the operator
  // from working. A scan asked for by hand still runs, so a paused agent can
  // be shown reading the news without being able to act on it.
  if (!opts.force && isAgentPaused()) {
    s.lastPollAt = new Date().toISOString();
    return {
      fetched: 0, fresh: 0, kept: 0, started: 0,
      errors: [], seeded, paused: true, latencyMs: Date.now() - started,
    };
  }

  try {
    const { items, results } = await fetchAllFeeds();
    const errors = results.filter((r) => r.error).map((r) => `${r.source.name}: ${r.error}`);
    const fresh = items.filter((i) => !alreadySeen(i.id));

    let kept = 0;
    let startedJobs = 0;

    // Newest first. `reorder` sorts the history by publication time, so the
    // write order no longer decides what the page shows — which frees this
    // loop to spend the seeding budget on the freshest headlines rather than
    // whatever happens to come out of the parser last.
    //
    // On the seeding pass most of this is back catalogue and none of it is
    // verified, except headlines published inside the freshness window: that
    // is live news which broke while the server was down, and declining to
    // look at it is why the automated path could go a whole session without
    // producing a single record.
    //
    // The budget is counted against jobs that actually START, not against
    // candidates. Reserving it up front spends it on items triage then throws
    // away, so two dismissed headlines at the top of the feed could starve a
    // real signal three rows down.
    let seedBudget = seeded ? Math.max(0, SEED_MAX_JOBS) : Infinity;
    const freshEnoughToVerify = seedFreshnessGate(Date.now());

    for (const item of fresh) {
      const mayStart = !seeded || (seedBudget > 0 && freshEnoughToVerify(item.publishedAt));
      const record = await ingestItem(item, { startJobs: mayStart });
      if (record.verdict.keep) kept++;
      if (record.jobId) {
        startedJobs++;
        seedBudget--;
      }
    }

    s.seeding = false;
    s.lastPollAt = new Date().toISOString();
    s.lastPollError = errors.length ? errors.join("; ") : null;
    s.polls++;

    return {
      fetched: items.length,
      fresh: fresh.length,
      kept,
      started: startedJobs,
      errors,
      seeded,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    s.lastPollError = message;
    s.lastPollAt = new Date().toISOString();
    return { fetched: 0, fresh: 0, kept: 0, started: 0, errors: [message], seeded, latencyMs: Date.now() - started };
  }
}

const POLL_INTERVAL_MS = Number(process.env.INGEST_POLL_INTERVAL_MS ?? 60_000);

/**
 * Start the timer, once per process.
 *
 * `unref` so the interval never holds a script open. Anything importing this
 * module for its types or its history should not inherit a process that
 * refuses to exit.
 */
export function startPolling(): { started: boolean; intervalMs: number } {
  const s = state();
  if (s.timer) return { started: false, intervalMs: POLL_INTERVAL_MS };

  void pollOnce();
  s.timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  s.timer.unref?.();
  return { started: true, intervalMs: POLL_INTERVAL_MS };
}

export function stopPolling(): boolean {
  const s = state();
  if (!s.timer) return false;
  clearInterval(s.timer);
  s.timer = null;
  return true;
}

/**
 * Lay a worked history underneath whatever the poller finds.
 *
 * Takes items oldest-first and pushes them on in that order, so the newest
 * ends up at the head exactly as a real poll would leave it. Their ids join
 * `seen`, so a later poll returning the same story does not double up.
 *
 * Kept separate from `ingestItem` on purpose: this writes records that already
 * carry their verdict and never starts a job, so it cannot spend inference.
 */
export function seedIngest(items: IngestedItem[]): void {
  const s = state();
  for (const item of items) {
    if (s.seen.has(item.id)) continue;
    s.seen.add(item.id);
    s.history.unshift(item);
  }
  reorder(s);
}

export function ingestHistory(limit = 50): IngestedItem[] {
  return state().history.slice(0, limit);
}

/** One screened headline by feed id, for the operator's manual verify. */
export function ingestItemById(id: string): IngestedItem | null {
  return state().history.find((i) => i.id === id) ?? null;
}

/**
 * Verify a headline the screening kept but never sent to the models.
 *
 * The seeding pass records a day of back catalogue without spending inference
 * on it, which is right, and it leaves those records as dead ends: promoted,
 * reasoned about, and pointing at nothing. This is the operator's way to send
 * one of them through, so the automated path can be shown on demand instead of
 * waiting for the newswires to produce a crisis.
 *
 * Idempotent. A headline that already has a job returns it rather than paying
 * for a second opinion on the same sentence.
 */
export async function verifyIngestedItem(
  id: string,
): Promise<{ jobId: string; alreadyRunning: boolean } | { error: string }> {
  const record = ingestItemById(id);
  if (!record) return { error: `No screened headline with id ${id}.` };
  if (record.jobId) return { jobId: record.jobId, alreadyRunning: true };
  if (!record.verdict.keep) {
    return {
      error:
        "Screening dismissed this headline. Verifying it anyway would spend inference on something the filter already answered.",
    };
  }

  const text = record.summary ? `${record.title}. ${record.summary}` : record.title;
  const alert: AlertEvent = {
    id: newCorrelationId(),
    source: { type: "NEWS", name: record.sourceName, url: record.url },
    rawText: text,
    sourceUrl: record.url,
    receivedAt: record.publishedAt,
    clusterKey: clusterKeyFor(record.title),
    metadata: { feedItemId: record.id, triage: record.verdict.reason },
  };

  const job = await startVerification(alert, {
    dryRun: process.env.INGEST_LIVE_TRADING !== "true",
  });
  record.jobId = job.jobId;
  return { jobId: job.jobId, alreadyRunning: false };
}

export function ingestStats() {
  const s = state();
  const screened = s.history.length;
  const kept = s.history.filter((i) => i.verdict.keep).length;
  return {
    polling: s.timer !== null,
    intervalMs: POLL_INTERVAL_MS,
    polls: s.polls,
    lastPollAt: s.lastPollAt,
    lastPollError: s.lastPollError,
    screened,
    kept,
    rejected: screened - kept,
  };
}
