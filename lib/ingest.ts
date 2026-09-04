import { createHash } from "node:crypto";
import { newCorrelationId } from "./ids";
import { startVerification } from "./runtime";
import { fetchAllFeeds, type FeedItem } from "./feeds";
import { sameEvent, triage, type TriageVerdict } from "./triage";
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

function remember(item: IngestedItem): void {
  const s = state();
  s.seen.add(item.id);
  s.history.unshift(item);
  if (s.history.length > MAX_HISTORY) s.history.length = MAX_HISTORY;
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
  latencyMs: number;
}

/**
 * One pass over every feed.
 *
 * Never throws. This runs on a timer with nobody watching, and an unhandled
 * rejection in a background interval takes the dev server with it.
 */
export async function pollOnce(): Promise<PollResult> {
  const started = Date.now();
  const s = state();
  const seeded = s.seeding;

  try {
    const { items, results } = await fetchAllFeeds();
    const errors = results.filter((r) => r.error).map((r) => `${r.source.name}: ${r.error}`);
    const fresh = items.filter((i) => !alreadySeen(i.id));

    let kept = 0;
    let startedJobs = 0;
    // Oldest first, because `remember` unshifts. Ingesting a newest-first list
    // would leave the history reversed, and the trim to MAX_HISTORY would then
    // discard the newest items rather than the stalest ones.
    for (const item of [...fresh].reverse()) {
      const record = await ingestItem(item, { startJobs: !seeded });
      if (record.verdict.keep) kept++;
      if (record.jobId) startedJobs++;
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

export function ingestHistory(limit = 50): IngestedItem[] {
  return state().history.slice(0, limit);
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
