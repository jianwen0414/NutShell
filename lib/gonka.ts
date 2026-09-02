import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import type {
  AlertEvent,
  EvidencePacket,
  ModelVerdict,
  Stance,
  VerificationResult,
  VoteFailure,
} from "@/types";
import { AppError } from "./errors";
import { newCorrelationId } from "./ids";
import { computeConsensus, QUORUM_MIN } from "./consensus";

// ── Client ────────────────────────────────────────────────────────────────
// Gonka only. No OpenAI, no Anthropic, no local model, not even as a
// fallback. If Gonka is down the correct behaviour is GONKA_UNAVAILABLE.

const BASE_URL = process.env.GONKA_BASE_URL ?? "https://api.gonkarouter.io/v1";
// Measured across 30-31 Aug 2026. WHICH model is degraded ROTATES, so do not
// build around any one of them being the weak link:
//   30 Aug pm  Kimi 2/6, DeepSeek 2/2
//   31 Aug am  Kimi 1.5s, DeepSeek fine
//   31 Aug pm  Kimi 0/6, DeepSeek 0/2      (whole network degraded)
//   31 Aug     Kimi 4/4 @2.2s, DeepSeek 1/4 @32s   (roles reversed)
// Gonka confirmed the cause: node selection happens upstream and the same
// model answers in under a second or in 30-40s depending which node takes it.
// Streaming showed the delay sits entirely before generation starts.
// 45s turns that wait into a fast missing vote; quorum (2 of 3) absorbs it.
// Re-check with `npm run diag:kimi` before relying on any of this.
//
// Do NOT switch these calls to streaming to "fail faster". Measured: with
// stream:true the HTTP response opens immediately and the SDK timeout stops
// applying, so a queued Kimi ran 600s past a 120s timeout. Streaming here
// needs a manual inter-chunk watchdog or it removes the only protection we
// have. Non-streaming waits for the whole body, so the timeout actually bites.
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TOKENS = 2048; // two of three models emit reasoning tokens first
// 0, not 0.2. The same fixture has scored 55, 62, 65, 73 and 75 across runs,
// and a demo that sometimes hedges and sometimes does not is unusable. We want
// the models' independent judgement, not their sampling noise — the diversity
// that makes consensus meaningful comes from using three different models,
// not from randomness inside each one.
const TEMPERATURE = 0;

/**
 * Deferred hedge (tied request) — send a duplicate if the first is slow.
 *
 * Gonka support suggested 1.5-2s, but that assumes time-to-FIRST-TOKEN, which
 * needs streaming, and streaming here breaks the timeout (see above). For a
 * non-streaming call "no response yet" means "not finished yet", and measured
 * completion times are DeepSeek 2-19s, MiniMax 7-43s, Kimi 20-40s when
 * healthy. A 2s trigger would duplicate essentially every call.
 *
 * 14s sits above the normal band for the two reliable models, so a healthy
 * call is never duplicated, and a straggler gets a second chance at 14s
 * instead of dying silently at the 45s timeout. Duplicates are safe: these are
 * stateless reads and no money moves at the verification step.
 */
const HEDGE_AFTER_MS = Number(process.env.GONKA_HEDGE_AFTER_MS ?? 14_000);

function client(): OpenAI {
  const apiKey = process.env.GONKA_API_KEY;
  if (!apiKey)
    throw new AppError("GONKA_UNAVAILABLE", "GONKA_API_KEY is not set");
  // maxRetries 0 on purpose. The SDK retries timeouts, which turned one hung
  // Kimi call into 249s of wall time. Quorum (2 of 3) already covers a lost
  // vote — that is cheaper than stalling the whole verification.
  return new OpenAI({ apiKey, baseURL: BASE_URL, maxRetries: 0 });
}

// ── Model resolution — never hardcode ids ────────────────────────────────
// Observed id formats vary by key and over time:
//   "MiniMaxAI/MiniMax-M2.7" · "moonshotai/Kimi-K2.6" · "minimax-m2-7" · "kimi-k2-6"
// Match on the family word only — it is the one stable token across all forms.
export const MODEL_FAMILIES = ["minimax", "kimi", "deepseek"] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/**
 * Which family runs layer 2.
 *
 * MiniMax is the better writer — planning and long-chain structure are its
 * stated strengths — and it was the original choice. Measured, it times out as
 * synthesizer in about half of runs: its analyst calls already take 37-43s and
 * the synthesizer prompt is larger still, so it overruns the 45s budget.
 *
 * DeepSeek answers in 3-11s with no reasoning preamble and has not failed a
 * single call across every test. A slightly plainer trace that always renders
 * beats an elegant one that is missing half the time — and layer 2 is
 * narrative only, so nothing numeric rides on this choice.
 */
const SYNTHESIZER_FAMILY: ModelFamily = "deepseek";

/**
 * Order to try for layer 2. DeepSeek first because it answers without a
 * reasoning preamble and fits the budget most easily, but ANY of them can be
 * the degraded one on a given afternoon, so we fall through rather than
 * pinning the narrative to a single model's availability.
 */
const SYNTHESIZER_ORDER: readonly ModelFamily[] = [
  "deepseek",
  "minimax",
  "kimi",
];

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { at: number; ids: string[] } | null = null;

export async function resolveSynthesizer(): Promise<string> {
  return (await synthesizerCandidates())[0]!;
}

/** Every model worth trying for layer 2, best first. */
export async function synthesizerCandidates(): Promise<string[]> {
  const ids = await resolveModels();
  const ordered: string[] = [];
  for (const family of SYNTHESIZER_ORDER) {
    const hit = ids.find((id) => id.toLowerCase().includes(family));
    if (hit) ordered.push(hit);
  }
  for (const id of ids) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

export async function resolveModels(force = false): Promise<string[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.ids;

  let available: string[];
  try {
    const res = await client().models.list();
    available = res.data.map((m) => m.id);
  } catch (e) {
    throw new AppError("GONKA_UNAVAILABLE", `GET /models failed: ${String(e)}`);
  }

  const ids: string[] = [];
  for (const family of MODEL_FAMILIES) {
    const hit = available.find((id) => id.toLowerCase().includes(family));
    if (hit) ids.push(hit);
  }

  if (ids.length < QUORUM_MIN) {
    throw new AppError(
      "GONKA_UNAVAILABLE",
      `Resolved only ${ids.length} model families; need at least ${QUORUM_MIN}.`,
      { available, matched: ids },
    );
  }

  if (ids.length < MODEL_FAMILIES.length) {
    // Quorum survives on 2, but the product claims a three-model consensus.
    // Running two-wide without saying so overstates what the number means.
    const missing = MODEL_FAMILIES.filter(
      (f) => !ids.some((id) => id.toLowerCase().includes(f)),
    );
    console.warn(
      `[gonka] DEGRADED: only ${ids.length}/${MODEL_FAMILIES.length} families resolved. ` +
        `Missing: ${missing.join(", ")}. Available from the router: ${available.join(", ")}`,
    );
  }

  cache = { at: Date.now(), ids };
  return ids;
}

// ── Prompts ───────────────────────────────────────────────────

export const ANALYST_PROMPT = `You are an impartial verification analyst assessing whether a breaking claim about
a cryptocurrency protocol, exchange, or token is factually true.

You will be given a claim. Assess it on evidence and internal consistency alone.

RULES
- Be objective. Do not favour alarming or reassuring readings.
- Cite specific evidence from the claim itself. Never invent facts, addresses,
  transaction hashes, or figures that are not present in the input.
- If the claim lacks verifiable specifics, that is itself evidence of low
  reliability — say so explicitly in redFlags.
- Judge the claim's credibility, not its emotional intensity.
- UNCERTAIN is only for text that genuinely supports both readings. If there is
  nothing substantive to assess, that is not uncertainty — score it low and say
  so in redFlags. Do not use UNCERTAIN to avoid committing.

WHAT YOU ARE AND ARE NOT BEING ASKED
You have no internet access and no knowledge of recent events. You are NOT
being asked whether this event actually happened. You are being asked how
credible the report is, judged on the text in front of you.

- Do NOT lower the score merely because you cannot independently confirm it.
  Breaking news is unconfirmable by definition. Inability to confirm is not
  evidence of falsehood, and treating it as such collapses every real report
  into the same band as every hoax.
- "UNCERTAIN" means the text itself is genuinely ambiguous — not that you
  personally lack confirmation.
- Score the REPORT: does it carry the marks of genuine reporting (named
  actors, precise figures, timestamps, a stated technical mechanism,
  checkable identifiers, internally consistent detail) or the marks of
  fabrication (vagueness, urgency, appeals to authority, implausible
  mechanics, round numbers, recycled details, no falsifiable specifics)?

SCORING RUBRIC (claimScore, 0-100)
  0-19   Almost certainly false. Hallmarks of a hoax, parody, or spoofed source.
  20-39  Probably false. Major unverifiable elements or contradictions.
  40-59  Genuinely uncertain. Plausible but unsupported.
  60-79  Credible. Specific, internally consistent, plausible detail. A
         competent reporter could have written this.
  80-100 Highly credible. Concrete checkable specifics — addresses, amounts,
         timestamps, a named mechanism — with no internal contradictions.
         Score here even though you cannot confirm the event. You are rating
         the report, not the world.

YOUR STANCE MUST MATCH YOUR SCORE
  claimScore 0-39    -> "FAKE"
  claimScore 40-59   -> "UNCERTAIN"
  claimScore 60-100  -> "REAL"

Scoring 62 and then answering "UNCERTAIN" is a contradiction: 62 sits in the
credible band. Choose the score first, then the stance that band implies. If
the stance you want disagrees with the score you gave, one of them is wrong —
revise the score, do not mislabel it.

SEVERITY (1-5), assuming the claim were TRUE
  1 Negligible market impact
  2 Minor, single-protocol, contained
  3 Significant, one major protocol or asset affected
  4 Severe, contagion likely across protocols
  5 Critical, systemic — major bridge, large exchange, or major stablecoin

CALIBRATION ANCHORS
Score against these two worked examples, not against your own instinct.

Example A — claimScore 88, stance REAL
  "Chainalysis reports the validator keys were compromised through a
   spear-phishing email to a senior engineer. 173,600 ETH and 25.5M USDC moved
   to 0x098b...b5a1 across two transactions on 23 March. Withdrawals were only
   paused six days later, after a user reported a failed withdrawal."
  Why: named investigator, exact figures, an address, dates, a stated attack
  mechanism, and an incidental detail (how it was noticed) that a fabricator
  would have no reason to invent.

Example B — claimScore 12, stance FAKE
  "URGENT: exchange insolvent, withdrawals frozen, the CEO has fled the
   country. My source inside confirms. Get your funds out NOW."
  Why: no figures, no timestamps, no checkable identifier, anonymous sourcing,
  and urgency doing the work that evidence should be doing.

A report carrying the specificity of Example A belongs in the 80s EVEN THOUGH
you cannot confirm the event occurred. Withholding a high score because you
personally cannot verify it is the single most common error on this task.

OUTPUT
Return ONLY a JSON object. No prose, no markdown, no code fences.
Fill keyEvidence and redFlags FIRST, then choose a claimScore consistent with
what you just listed — the number follows the evidence, not the other way round.
{
  "keyEvidence": [<string>, ...],   // max 4, each under 25 words
  "redFlags": [<string>, ...],      // max 4, each under 25 words; [] if none
  "stance": "REAL" | "FAKE" | "UNCERTAIN",
  "severity": <int 1-5>,
  "claimScore": <int 0-100>
}`;

const SYNTHESIZER_PROMPT = `You are a consensus synthesizer. Three independent AI models have each assessed
the same claim. Their verdicts are below.

Your job is to explain the collective reasoning to a human who must decide whether
to spend money on financial protection. You do NOT assign a truth score — that is
computed mechanically from the three models and is not yours to change.

Where the models disagree, say so explicitly and explain the disagreement. A
reader must be able to see exactly where the models diverged and why.

If an ONCHAIN_EVIDENCE block is present, it holds direct measurements of Base
mainnet taken before the models were asked. Say what it showed and whether the
models' conclusions line up with it. Where a model's reasoning conflicts with a
measurement, name the conflict rather than smoothing it over — the reader is
about to spend money and needs to see it.

OUTPUT — JSON only, no prose, no code fences.
{
  "severity": <int 1-5>,
  "reasoningTrace": [<string>, ...],
  "disagreementSummary": <string>
}`;

/**
 * "Data thickness" — how much of the alert the models actually see.
 *
 * MEASURED, and the reason this is deliberately thin. An earlier version put
 * provenance in a CONTEXT block: channel, timestamp, handle, follower count.
 * The models used it against the claim. MiniMax on a legitimate exploit report:
 *
 *   "Context block shows channel: SIMULATOR — raises questions about whether
 *    this is a real alert"  → stance UNCERTAIN, claimScore 55
 *
 * Telling a model the alert came from a simulator teaches it the alert is
 * fake, and every score in every test was depressed by it. The same trap runs
 * the other way: a "credibilityScore: 98" would inflate every score instead.
 *
 * So provenance does not reach the scorer at all. It is a source-reliability
 * judgement, we hold no source history to make one, and a signal that cannot
 * legitimately raise a score must not be allowed to lower one either. The UI
 * still displays channel, handle and URL — they are useful to a human reading
 * the verdict. They are not evidence about whether the claim is true.
 *
 * `context` is reserved for genuinely evidentiary material — the body of a
 * fetched article, for instance — never for metadata about the delivery.
 */
export function renderAlert(
  alert: AlertEvent,
  context?: string,
  /**
   * Stage 02 output. Qualifies as evidentiary under the rule above: these are
   * measurements taken from Base mainnet, the Chainlink feeds and DeFiLlama,
   * not metadata about how the alert reached us. Whoever wrote the claim
   * cannot author them, which is exactly what makes them worth showing.
   */
  evidence?: EvidencePacket,
): string {
  const claim = `<CLAIM>
${alert.rawText.trim()}
</CLAIM>`;

  const parts = [claim];

  if (context) {
    parts.push(`<RETRIEVED_SOURCE>
${context.trim()}
</RETRIEVED_SOURCE>

RETRIEVED_SOURCE is material fetched from the claim itself. Judge both together.`);
  }

  if (evidence?.promptBlock) {
    parts.push(evidence.promptBlock);
  }

  if (!context && !evidence?.promptBlock) {
    parts.push('Judge the CLAIM on its own content.');
  } else if (evidence?.promptBlock) {
    parts.push(
      'Judge the CLAIM against the evidence above. The evidence is measured, the claim is asserted;\n' +
      'where they conflict, the measurement is the more reliable of the two.',
    );
  }

  return parts.join('\n\n');
}

// ── Schemas ───────────────────────────────────────────────────────────────

/**
 * Clamp rather than reject. A model answering 85.5, "85", or severity 6 has
 * still told us what it thinks — throwing that away costs a vote for a
 * formatting quibble. The "missing vote" rule is for output we cannot
 * READ, not output we can read and would rather were tidier.
 */
const boundedInt = (min: number, max: number) =>
  z.coerce
    .number()
    .refine(Number.isFinite, "not a finite number")
    .transform((n) => Math.min(max, Math.max(min, Math.round(n))));

/** Models occasionally answer "Real" or " FAKE ". Normalise before matching. */
const stanceField = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.enum(["REAL", "FAKE", "UNCERTAIN"]));

const AnalystSchema = z.object({
  claimScore: boundedInt(0, 100),
  severity: boundedInt(1, 5),
  stance: stanceField,
  keyEvidence: z.array(z.string()).default([]),
  redFlags: z.array(z.string()).default([]),
});

const SynthSchema = z.object({
  severity: boundedInt(1, 5),
  reasoningTrace: z.array(z.string()).min(1),
  disagreementSummary: z.string().default(""),
});

// ── Parse-and-repair ──────────────────────────────────────────
// Never regex-scrape values out of prose. A malformed response is a missing
// vote, not a guess.

/** Strip fences, then extract the first balanced object literal. */
export function extractJson(raw: string): string | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function parseWith<S extends z.ZodTypeAny>(
  schema: S,
  raw: string,
): z.output<S> | null {
  const block = extractJson(raw);
  if (!block) return null;
  try {
    return schema.parse(JSON.parse(block));
  } catch {
    return null;
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ── Chain resolution — resolves open item V3 ──────────────────────────────

/**
 * VERIFIED 31 Aug 2026. The response id is `devshard-<escrowId>-<nonce>`, and
 * the escrow id IS an on-chain record, publicly queryable with no key:
 *
 *   GET /productscience/inference/inference/devshard_escrow/{id}
 *
 * Checked against five ids spanning all three models. Every one resolved and
 * the record's `model_id` matched the model actually called:
 *
 *   66204 → MiniMaxAI/MiniMax-M2.7        66616 → deepseek-ai/DeepSeek-V4-Flash
 *   66767 → moonshotai/Kimi-K2.6          66691 → deepseek-ai/DeepSeek-V4-Flash
 *   66612 → moonshotai/Kimi-K2.6
 *
 * The record names the model, the epoch, the router's creator account and the
 * participant nodes serving that shard.
 *
 * ⚠️ WHAT IT DOES AND DOES NOT PROVE. It resolves the SHARD, not the single
 * inference. It shows which model, which epoch and which nodes could have
 * executed it. The trailing nonce is not a slot index — nonce 81 against a
 * 16-slot shard is out of range — so we cannot name the one executing node,
 * and the record carries no prompt or response hash. Claim the shard, not the
 * call. The SHA-256 response hash is what covers the content.
 */
const CHAIN_API =
  process.env.GONKA_CHAIN_API ?? "https://node1.gonka.ai:8443/chain-api";

/**
 * Decimal only, deliberately.
 *
 * Every id observed has been decimal, and each was confirmed against the chain
 * endpoint, which takes a uint64. Widening this to accept hex would be unsafe
 * rather than tolerant: "66853" is also valid hex, worth 420435 in decimal, so
 * a hex-tolerant parser cannot know which radix a numeric id means. Guessing
 * wrong yields a link that resolves to SOMEBODY ELSE'S shard — a confident,
 * wrong answer, which is worse than no link.
 *
 * So an unrecognised format returns undefined and says so loudly. A silent
 * empty link is the failure mode to avoid; a warning in the log is not.
 */
export function parseShardId(requestId: string): number | undefined {
  const id = requestId.trim();
  const m = /^devshard-(\d+)-\d+$/.exec(id);
  if (m) return Number(m[1]);
  if (id.startsWith("devshard-")) {
    console.warn(
      `[gonka] request id "${id}" is not decimal devshard-<n>-<n>. The format may ` +
        `have changed. Not guessing a radix: verify against the chain and update ` +
        `parseShardId. Chain links are disabled until then.`,
    );
  }
  return undefined;
}

export function chainUrlForShard(shardId: number): string {
  return `${CHAIN_API}/productscience/inference/inference/devshard_escrow/${shardId}`;
}

// ── Raw call ──────────────────────────────────────────────────────────────

interface RawCall {
  content: string;
  requestId: string;
  responseHash: string;
  finishReason: string;
  completionTokens: number;
  /** From the x-devshard-id response header. Authoritative, no parsing. */
  shardId?: number;
  /** True when the router served a DIFFERENT model than the one requested. */
  substituted: boolean;
  returnedModel: string;
}

/**
 * Exported for `scripts/measure-evidence-cost.ts` only.
 *
 * That script has to measure the real call — same timeout, same no-fallback
 * header, same maxRetries 0 — because the question it answers is whether a
 * larger prompt changes latency or pushes the completion past its ceiling.
 * Re-creating a client in the script would measure a different call.
 */
export async function chat(
  modelId: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RawCall> {
  const { data: res, response } = await client()
    .chat.completions.create(
      {
        model: modelId,
        messages,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      },
      {
        timeout: timeoutMs,
        ...(signal ? { signal } : {}),
        headers: {
          // Pin the model. Under saturation the router may otherwise serve a
          // SUBSTITUTE model. Our entire premise is three DIFFERENT models
          // judging independently — a silent substitution could have us
          // averaging the same model twice and calling it consensus.
          "X-Gonka-No-Fallback": "true",
        },
      },
    )
    .withResponse();

  // The router reports a substitution two ways; trust either.
  const flagged = response.headers.get("x-gonka-fallback");
  const returnedModel = res.model ?? "";
  const substituted =
    Boolean(flagged) || (returnedModel !== "" && returnedModel !== modelId);

  // Prefer the header over parsing the id string: it is the router's own
  // answer and survives any change to the id format.
  const headerShard = Number(response.headers.get("x-devshard-id"));

  return {
    content: res.choices[0]?.message?.content ?? "",
    finishReason: res.choices[0]?.finish_reason ?? "unknown",
    completionTokens: res.usage?.completion_tokens ?? 0,
    shardId:
      Number.isFinite(headerShard) && headerShard > 0
        ? headerShard
        : parseShardId(res.id ?? ""),
    substituted,
    returnedModel,
    requestId: res.id ?? "",
    // Hash the full raw body — this makes the verdict tamper-evident and is
    // displayed in place of a chain link while V3 is unresolved.
    responseHash: sha256(JSON.stringify(res)),
  };
}

/**
 * Fire the call; if it has not finished by HEDGE_AFTER_MS, fire a second copy
 * and take whichever finishes first. The loser is aborted so it stops burning
 * a node slot.
 *
 * This is a LATENCY tactic applied WITHIN one model's call. It must never
 * be confused with the three-model panel, which is a SAFETY property: those
 * three exist to disagree with each other and all of them must be waited for.
 * Racing them would delete the product.
 */
async function hedgedChat(
  modelId: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  timeoutMs: number,
): Promise<RawCall> {
  const controllers: AbortController[] = [];
  const attempt = (tag: string, budgetMs: number) => {
    const ac = new AbortController();
    controllers.push(ac);
    return chat(modelId, messages, budgetMs, ac.signal).then((r) => ({
      r,
      tag,
    }));
  };

  const primary = attempt("primary", timeoutMs);
  let hedgeTimer: NodeJS.Timeout | undefined;

  // The hedge gets only the REMAINING budget, so a doomed call still gives up
  // at timeoutMs overall. Without this the backup starts its own full clock and
  // a hopeless request runs to timeoutMs + HEDGE_AFTER_MS, making the worst
  // case worse than having no hedge at all.
  const hedgeBudget = Math.max(1_000, timeoutMs - HEDGE_AFTER_MS);

  const hedge = new Promise<{ r: RawCall; tag: string }>((resolve, reject) => {
    hedgeTimer = setTimeout(
      () => attempt("hedge", hedgeBudget).then(resolve, reject),
      HEDGE_AFTER_MS,
    );
  });

  try {
    const { r, tag } = await Promise.any([primary, hedge]);
    if (tag === "hedge")
      console.warn(`[gonka] ${modelId}: hedge won, primary was slow`);
    return r;
  } catch (e: any) {
    // Promise.any only rejects when EVERY attempt failed; surface a real error.
    throw e?.errors?.[0] ?? e;
  } finally {
    clearTimeout(hedgeTimer);
    for (const ac of controllers) ac.abort();
  }
}

// ── Layer 1 ───────────────────────────────────────────────────────────────

/**
 * Classify a thrown call so the failure carries a real ErrorCode instead of
 * disappearing. GONKA_TIMEOUT and GONKA_MALFORMED_JSON are both in the frozen
 * registry and were previously never raised.
 */
function classify(e: unknown): { code: VoteFailure["code"]; detail: string } {
  const err = e as { name?: string; status?: number; message?: string };
  const msg = err?.message ?? String(e);
  if (
    err?.name === "APIConnectionTimeoutError" ||
    /timed out|ETIMEDOUT/i.test(msg)
  ) {
    return { code: "GONKA_TIMEOUT", detail: msg };
  }
  // 429 is its own thing and must not hide inside GONKA_UNAVAILABLE. It means
  // we asked for too much at once, not that Gonka is down, and the fix is on
  // our side. Measured limit is 21 concurrent per key — far below the 200 the
  // workshop deck advertises — and the deferred hedge doubles our footprint,
  // so this is reachable. RATE_LIMITED is retryable in the error registry, and
  // the quorum-rescue round is what actually recovers the vote.
  if (err?.status === 429 || /rate limit|too many concurrent/i.test(msg)) {
    return { code: "RATE_LIMITED", detail: msg };
  }
  return {
    code: "GONKA_UNAVAILABLE",
    detail: err?.status ? `HTTP ${err.status}: ${msg}` : msg,
  };
}

type AnalystOutcome =
  { ok: true; verdict: ModelVerdict } | { ok: false; failure: VoteFailure };

/** One analyst call with at most ONE repair retry. */
async function callAnalyst(
  modelId: string,
  alert: AlertEvent,
  timeoutMs: number,
  evidence?: EvidencePacket,
): Promise<AnalystOutcome> {
  const started = Date.now();
  const userMsg = renderAlert(alert, undefined, evidence);

  const fail = (code: VoteFailure["code"], detail: string): AnalystOutcome => {
    // Never swallow a dropped vote. A degraded run that looks identical to a
    // healthy one is undiagnosable at 2am before a demo.
    console.warn(
      `[gonka] ${modelId} dropped: ${code} — ${detail.slice(0, 200)}`,
    );
    return {
      ok: false,
      failure: {
        modelId,
        code,
        detail: detail.slice(0, 500),
        latencyMs: Date.now() - started,
      },
    };
  };

  let call: RawCall;
  try {
    call = await hedgedChat(
      modelId,
      [
        { role: "system", content: ANALYST_PROMPT },
        { role: "user", content: userMsg },
      ],
      timeoutMs,
    );
  } catch (e) {
    const { code, detail } = classify(e);
    return fail(code, detail);
  }

  let parsed = parseWith(AnalystSchema, call.content);
  let repaired = false;

  if (!parsed) {
    repaired = true;
    try {
      call = await chat(
        modelId,
        [
          { role: "system", content: ANALYST_PROMPT },
          { role: "user", content: userMsg },
          { role: "assistant", content: call.content },
          {
            role: "user",
            content:
              "Your previous response was not valid JSON. Return ONLY the JSON object, no other text.",
          },
        ],
        timeoutMs,
      );
      parsed = parseWith(AnalystSchema, call.content);
    } catch (e) {
      const { code, detail } = classify(e);
      return fail(code, `${code} during repair retry: ${detail}`);
    }
  }

  // A substituted model cannot count. Consensus means three DIFFERENT models
  // agreeing; if the router served MiniMax when we asked for Kimi, counting it
  // would average one model's opinion twice and call the result agreement.
  // Better a missing vote, which quorum already handles, than a fake one.
  if (call.substituted) {
    return fail(
      "GONKA_UNAVAILABLE",
      `router substituted ${call.returnedModel || "an unknown model"} for ${modelId}; ` +
        `vote discarded to keep the panel distinct`,
    );
  }

  const shardId = call.shardId;

  if (!parsed) {
    // finish_reason 'length' means the model spent its budget on reasoning
    // tokens and never reached the JSON — raise MAX_TOKENS if this recurs.
    return fail(
      "GONKA_MALFORMED_JSON",
      `unparseable after one repair (finish_reason=${call.finishReason}, ` +
        `completion_tokens=${call.completionTokens}) tail=${JSON.stringify(
          call.content.slice(-300),
        )}`,
    );
  }

  return {
    ok: true,
    verdict: {
      modelId,
      role: "ANALYST",
      claimScore: parsed.claimScore,
      severity: parsed.severity as ModelVerdict["severity"],
      stance: parsed.stance as Stance,
      keyEvidence: parsed.keyEvidence.slice(0, 6),
      redFlags: parsed.redFlags.slice(0, 6),
      gonkaRequestId: call.requestId,
      ...(shardId !== undefined
        ? { chainShardId: shardId, chainUrl: chainUrlForShard(shardId) }
        : {}),
      responseHash: call.responseHash,
      latencyMs: Date.now() - started,
      parseRepaired: repaired,
    },
  };
}

// ── Public entry point ────────────────────────────────────────────────────

export async function verifyThreat(
  alert: AlertEvent,
  opts: {
    debateMode?: boolean;
    timeoutMs?: number;
    /**
     * Stage 02 evidence. Absent means this behaves exactly as it did before
     * the investigation stage existed — the prompt is byte-identical — so a
     * failed or skipped investigation costs the verification nothing.
     */
    evidence?: EvidencePacket;
    /**
     * Fires as each model lands, not when all three finish. The probe uses it
     * for live progress; the worker uses it to emit the per-model `verdict`
     * SSE frame the UI renders per model.
     */
    onVerdict?: (v: ModelVerdict | null, modelId: string) => void;
    /** Stage transitions. Feeds the `status` SSE frame. */
    onStage?: (stage: "layer1" | "retry" | "synthesizing") => void;
  } = {},
): Promise<VerificationResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const models = await resolveModels();
  opts.onStage?.("layer1");

  const verdicts: ModelVerdict[] = [];
  const failures: VoteFailure[] = [];

  const round = async (targets: string[]) => {
    const settled = await Promise.all(
      targets.map((m) =>
        callAnalyst(m, alert, timeoutMs, opts.evidence).then((r) => {
          opts.onVerdict?.(r.ok ? r.verdict : null, m);
          return r;
        }),
      ),
    );
    for (const r of settled) {
      if (r.ok) verdicts.push(r.verdict);
      else failures.push(r.failure);
    }
  };

  // Layer 1 — all three in parallel, identical prompt.
  await round(models);

  // Second chance. The gateway drops calls intermittently — measured, not
  // hypothetical — and losing quorum kills the whole verification. Retrying
  // costs time only in the failure case, which is exactly when it is worth
  // spending. One extra round, failed models only.
  if (verdicts.length < QUORUM_MIN) {
    opts.onStage?.("retry");
    await round(models.filter((m) => !verdicts.some((v) => v.modelId === m)));
  }

  // Throws GONKA_QUORUM_FAILED below 2 — now carrying why each model dropped,
  // so a failed verification says "Kimi timed out" rather than just "failed".
  let consensus;
  try {
    consensus = computeConsensus(verdicts);
  } catch (e) {
    if (e instanceof AppError) {
      throw new AppError(e.code, e.message, {
        ...e.details,
        failures: failures.map(
          (f) => `${f.modelId}: ${f.code} (${f.latencyMs}ms)`,
        ),
      });
    }
    throw e;
  }

  // Layer 2 — synthesizer. Explains; never sets truthScore.
  //
  // Tries each model in turn. Pinning this to one model made the reasoning
  // trace hostage to that model's availability, and measurement showed which
  // model is degraded rotates hour to hour. The trace is the readable part of
  // the verdict, so it is worth a second attempt on another model.
  opts.onStage?.("synthesizing");
  let reasoningTrace: string[] = [];
  for (const synthModel of await synthesizerCandidates()) {
    try {
      const call = await chat(
        synthModel,
        [
          { role: "system", content: SYNTHESIZER_PROMPT },
          {
            role: "user",
            // The synthesizer sees the evidence too. The reasoning trace is
            // the part a human actually reads before deciding to spend money,
            // and "the models agreed, and the chain showed the contract
            // untouched" is a materially better explanation than the verdicts
            // alone can give.
            content: `${renderAlert(alert, undefined, opts.evidence)}

<VERDICTS>
${JSON.stringify(
  verdicts.map((v) => ({
    model: v.modelId,
    claimScore: v.claimScore,
    severity: v.severity,
    stance: v.stance,
    keyEvidence: v.keyEvidence,
    redFlags: v.redFlags,
  })),
  null,
  2,
)}
</VERDICTS>`,
          },
        ],
        timeoutMs,
      );
      const synth = parseWith(SynthSchema, call.content);
      if (synth) {
        reasoningTrace = synth.reasoningTrace;
        if (synth.disagreementSummary)
          reasoningTrace.push(synth.disagreementSummary);
        break;
      }
    } catch {
      // Try the next model. A failed synthesizer degrades the narrative, not
      // the decision: the mechanical numbers already stand on their own.
    }
  }

  if (reasoningTrace.length === 0) {
    reasoningTrace = [
      "Synthesizer unavailable — showing mechanical consensus only.",
    ];
  }

  return {
    correlationId: alert.id || newCorrelationId(),
    alertId: alert.id,
    verdicts,
    consensus,
    reasoningTrace,
    gonkaRequestIds: verdicts.map((v) => v.gonkaRequestId),
    // V3 RESOLVED: verified that every devshard id resolves on chain, so the
    // default is now true. Env can still force it off if the endpoint moves.
    idChainResolvable:
      process.env.GONKA_ID_CHAIN_RESOLVABLE !== "false" &&
      verdicts.some((v) => v.chainShardId !== undefined),
    verifiedAt: new Date().toISOString(),
    totalLatencyMs: Date.now() - started,
    ...(failures.length ? { failures } : {}),
  };
}
