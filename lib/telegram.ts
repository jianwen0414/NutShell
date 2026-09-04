/**
 * Telegram Alert Dispatcher for NutShell
 *
 * Sends high-priority push notifications to the operator's phone via Telegram
 * when the autonomous agent is running in MONITOR_ONLY mode and encounters
 * suspicious on-chain anomalies (Truth Score >= 60).
 */

import type {
  AlertEvent,
  EvidencePacket,
  HedgeDecision,
  HedgePosition,
  VerificationResult,
} from "@/types";
import type { ExecutionMode } from "./control-state";

export interface TelegramAlertPayload {
  jobId: string;
  alert: AlertEvent;
  evidence?: EvidencePacket;
  verification?: VerificationResult;
  decision?: HedgeDecision;
  /**
   * Which mode the agent was in when it decided.
   *
   * The alert used to be hardcoded to MONITOR_ONLY throughout — its header,
   * its action block and its buttons — because that was the only mode that
   * sent one. That left the two modes where the agent spends real money as
   * the two modes that notified nobody.
   */
  mode?: ExecutionMode;
  /** Present on the receipt sent after an autonomous fill. */
  position?: HedgePosition;
}

/** What the action block says, per mode. */
const MODE_COPY: Record<
  ExecutionMode,
  { icon: string; name: string; lines: string[] }
> = {
  MONITOR_ONLY: {
    icon: "👁",
    name: "MONITOR ONLY",
    lines: ["• No funds spent.", "• No hedge executed.", "• Recorded for your review."],
  },
  APPROVAL_REQUIRED: {
    icon: "✋",
    name: "AWAITING YOUR APPROVAL",
    lines: [
      "• The agent has sized a hedge and stopped.",
      "• Nothing is spent until you approve it.",
      "• Open the record below to approve or ignore.",
    ],
  },
  AUTONOMOUS: {
    icon: "🤖",
    name: "AUTONOMOUS",
    lines: ["• The agent is cleared to act on this without you."],
  },
};

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Dispatches a formatted HTML threat alert to Telegram.
 *
 * Threshold:
 * - Score >= 70: 🚨 CRITICAL CRISIS (Exploit / High confidence)
 * - Score >= 40: 🟡 SUSPICIOUS ANOMALY (Abnormal on-chain activity / Watch)
 * - Score < 40: Filtered out to avoid noise.
 */
export async function sendTelegramAlert(
  payload: TelegramAlertPayload,
): Promise<{ ok: boolean; simulated?: boolean; messageId?: number; error?: string }> {
  const truthScore = payload.verification?.consensus?.truthScore ?? 0;

  // Filter out noise / false alarms (< 40)
  if (truthScore < 40 && payload.decision?.tier !== "HEDGE_SMALL" && payload.decision?.tier !== "HEDGE_FULL") {
    console.info(`[telegram] Truth score ${truthScore} < 40 — filtered out.`);
    return { ok: true, simulated: true };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  const mode: ExecutionMode = payload.mode ?? "MONITOR_ONLY";
  const modeCopy = MODE_COPY[mode];
  const isCritical = truthScore >= 70;
  const severityTitle = isCritical ? "CRITICAL EXPLOIT DETECTED" : "ELEVATED SUSPICION DETECTED";
  const headerIcon = isCritical ? "🔴" : "🟡";
  const tierIcon = payload.decision?.tier === "HEDGE_FULL" || payload.decision?.tier === "HEDGE_SMALL" ? "🔴" : "🟡";

  // Full claim text without truncation
  const fullClaim = payload.alert.rawText.trim();

  // Concise on-chain investigation summary in plain human language
  const evidenceSections: string[] = [];
  if (payload.evidence) {
    const ev = payload.evidence;
    const tallyParts = [
      ev.contradicting > 0 ? `🟢 ${ev.contradicting} Normal` : null,
      ev.inconclusive > 0 ? `⚪ ${ev.inconclusive} Inconclusive` : null,
      ev.corroborating > 0 ? `🔴 ${ev.corroborating} Suspicious` : null,
    ].filter(Boolean);

    if (tallyParts.length > 0) {
      evidenceSections.push(`<b>📊 Overall Telemetry:</b>\n\n${tallyParts.join(" • ")}\n`);
    }

    if (ev.checks && ev.checks.length > 0) {
      const checkBullets = ev.checks.map((c) => {
        let icon = "⚪";
        if (c.stance === "CORROBORATES") icon = "🔴";
        else if (c.stance === "CONTRADICTS") icon = "🟢";

        const plainText = formatCheckInPlainLanguage(c);
        return `${icon} <b>${escapeHtml(c.title)}:</b> ${escapeHtml(plainText)}`;
      });
      evidenceSections.push(checkBullets.join("\n\n"));
    }
  }

  // AI Investigation Synthesis (from Gonka Synthesizer reasoningTrace)
  const aiTraceLines: string[] = [];
  if (payload.verification?.reasoningTrace && payload.verification.reasoningTrace.length > 0) {
    const cleanTraces = payload.verification.reasoningTrace
      .filter((t) => !t.toLowerCase().includes("synthesizer unavailable"))
      .slice(0, 2);
    for (const t of cleanTraces) {
      aiTraceLines.push(`• ${escapeHtml(t)}`);
    }
  }

  // Compile AI Triad votes
  const modelLines: string[] = [];
  if (payload.verification?.verdicts) {
    for (const m of payload.verification.verdicts) {
      const rawName = m.modelId.includes("/") ? m.modelId.split("/")[1] : m.modelId;
      const cleanName = rawName.replace(/-.*$/, "");
      const icon = m.stance === "REAL" ? "🔴" : m.stance === "FAKE" ? "🟢" : "⚪";
      modelLines.push(`${icon} <b>${escapeHtml(cleanName)}:</b> ${m.stance} • <code>${m.claimScore} / 100</code>`);
    }
  }

  const html = [
    `<b>${headerIcon} NUTSHELL DEFI GUARDIAN</b>`,
    `<b>${severityTitle}</b>`,
    ``,
    `${modeCopy.icon} <b>Mode:</b> ${modeCopy.name}`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `📊 <b>Truth Score: ${truthScore} / 100</b>`,
    `• <b>Recommended Action:</b> ${tierIcon} <b>${payload.decision?.tier ?? "WATCH"}</b>`,
    `• <b>Network:</b> Base Mainnet`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `<b>📋 CLAIM</b>`,
    `<blockquote>${escapeHtml(fullClaim)}</blockquote>`,
    `━━━━━━━━━━━━━━━━━━`,
    ...(evidenceSections.length > 0
      ? [
          `<b>🔍 ON-CHAIN INVESTIGATION</b>`,
          ``,
          ...evidenceSections,
          ...(aiTraceLines.length > 0
            ? [
                ``,
                ``,
                `<b>🤖 AI Synthesis:</b>`,
                aiTraceLines.join("\n\n"),
              ]
            : []),
          `━━━━━━━━━━━━━━━━━━`,
          ``,
        ]
      : []),
    ...(modelLines.length > 0
      ? [
          `<b>🤖 AI TRIAD</b>`,
          ``,
          modelLines.join("\n\n"),
          ``,
          `━━━━━━━━━━━━━━━━━━`,
        ]
      : []),
    `<b>🛡 ACTION</b>`,
    `${modeCopy.icon} <b>${modeCopy.name}</b>`,
    ...modeCopy.lines,
    ...(payload.position
      ? [
          ``,
          `<b>✅ FILLED</b>`,
          `• ${payload.position.asset} $${payload.position.strike} put, ${payload.position.contracts} contracts.`,
          `• Premium <b>$${payload.position.premiumPaidUsdc}</b> for <b>$${payload.position.notionalProtectedUsdc}</b> of cover.`,
          ...(payload.position.wasDryRun
            ? [`• <i>Dry run — priced and sized, nothing signed.</i>`]
            : [`• <code>${payload.position.entryTxHash}</code>`]),
        ]
      : []),
    `━━━━━━━━━━━━━━━━━━`,
    `🆔 <code>${payload.jobId}</code>`,
  ].filter((line) => line !== null && line !== undefined).join("\n");

  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const appUrl = (configuredAppUrl && isValidTelegramUrl(configuredAppUrl))
    ? configuredAppUrl.replace(/\/$/, "")
    : null;

  /**
   * One destination, because there is now one page that holds the whole
   * record: the claim, the chain evidence, all three verdicts, the decision
   * with its binding cap, and — when the mode calls for approval — the button
   * that actually executes.
   *
   * It used to be two buttons. The first pointed at `/?jobId=…`, which the
   * dashboard never read, so it landed on an idle page with none of this
   * incident on it. The second pointed at a page whose execute route had no
   * authentication. Both are fixed; both now resolve here.
   */
  const incidentUrl = appUrl ? `${appUrl}/incident/${payload.jobId}` : null;

  const wantsTrade =
    payload.decision?.tier === "HEDGE_FULL" || payload.decision?.tier === "HEDGE_SMALL";

  // The label has to match what tapping it will actually let you do. Offering
  // "approve this hedge" in MONITOR_ONLY — which the previous version did,
  // while the same message declared that no trade would be executed — sends
  // the reader to a page that contradicts the alert they are holding.
  const buttonText = !incidentUrl
    ? null
    : payload.position
      ? "📄 See the filled position"
      : mode === "APPROVAL_REQUIRED" && wantsTrade
        ? "🛡 Review and approve this hedge"
        : "🔎 Open the full incident record";

  const inlineKeyboard: Array<Array<{ text: string; url: string }>> =
    incidentUrl && buttonText ? [[{ text: buttonText, url: incidentUrl }]] : [];

  // With no NEXT_PUBLIC_APP_URL there is nowhere honest to send anyone, so the
  // message ships without buttons. It previously fell back to BaseScan's front
  // page dressed up as "View Investigation", which is a link that answers a
  // question nobody asked.
  const replyMarkup = inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined;

  if (!token || !chatId) {
    console.info(
      `[telegram] Notification simulated (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to receive live push notifications):\n${html.replace(/<[^>]+>/g, "")}`,
    );
    return { ok: true, simulated: true };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      }),
    });

    const body = await res.json();
    if (!res.ok || !body.ok) {
      console.error("[telegram] API delivery error:", body);
      return { ok: false, error: body.description ?? "Telegram API returned error" };
    }

    console.info(`[telegram] Alert sent successfully to chat ${chatId} (msg id ${body.result?.message_id}).`);
    return { ok: true, messageId: body.result?.message_id };
  } catch (e) {
    console.error("[telegram] Network error sending alert:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Sends a lightweight test ping to verify Telegram Bot API connectivity.
 */
export async function sendTelegramTestPing(opts?: {
  token?: string;
  chatId?: string;
}): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  const token = (opts?.token || process.env.TELEGRAM_BOT_TOKEN)?.trim();
  const chatId = (opts?.chatId || process.env.TELEGRAM_CHAT_ID)?.trim();

  if (!token || !chatId) {
    return {
      ok: false,
      error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID. Please set them in .env or provide them in the request.",
    };
  }

  const message = [
    `<b>🟢 NUTSHELL — TELEGRAM INTEGRATION ACTIVE</b>`,
    ``,
    `Your phone is now connected to <b>NutShell DeFi Guardian</b>.`,
    `When the agent is set to <b>👁 MONITOR ONLY</b>, you will receive instant push notifications whenever suspicious on-chain activity or exploit claims reach <b>Truth Score ≥ 40</b>.`,
    ``,
    `⏰ <i>Timestamp: ${new Date().toISOString()}</i>`,
  ].join("\n");

  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const appUrl = (configuredAppUrl && isValidTelegramUrl(configuredAppUrl))
    ? configuredAppUrl.replace(/\/$/, "")
    : "https://basescan.org";

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: configuredAppUrl && isValidTelegramUrl(configuredAppUrl) ? "🌐 Open Operator Dashboard" : "🌐 View Base Mainnet Explorer",
          url: appUrl,
        },
      ],
    ],
  };

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      }),
    });

    const body = await res.json();
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.description ?? "Telegram API rejected message" };
    }

    return { ok: true, messageId: body.result?.message_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function isValidTelegramUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return false;
    return true;
  } catch {
    return false;
  }
}

function formatCheckInPlainLanguage(c: { id?: string; title: string; stance: string; summary: string }): string {
  const stance = c.stance;
  const title = c.title.toLowerCase();

  if (title.includes("contract") || title.includes("pause")) {
    if (stance === "CORROBORATES") return "Emergency freeze/pause function was triggered.";
    return "Contract is operating normally. No emergency freeze or pause detected.";
  }

  if (title.includes("transfer")) {
    if (stance === "CORROBORATES") return "Abnormal surge in transfer volume detected on Base.";
    return "Transaction volume is normal. No sudden spike or panic transfers.";
  }

  if (title.includes("dex") || title.includes("liquidity")) {
    if (stance === "CORROBORATES") return "Severe drop in pool liquidity detected across exchanges.";
    const dollarMatch = c.summary.match(/\$[\d,]+(\.\d+)?/);
    const amount = dollarMatch ? ` (${dollarMatch[0]} available)` : "";
    return `Trading liquidity is strong${amount}. No signs of capital flight.`;
  }

  if (title.includes("price") || title.includes("peg") || title.includes("oracle")) {
    if (stance === "CORROBORATES") return "Significant price crash or oracle de-peg detected.";
    const priceMatch = c.summary.match(/\$[\d,]+(\.\d+)?/);
    const priceStr = priceMatch ? ` around ${priceMatch[0]}` : "";
    return `Market price is stable${priceStr}. Exchange prices match Chainlink feeds with no panic selling.`;
  }

  if (title.includes("tvl") || title.includes("protocol")) {
    if (stance === "CORROBORATES") return "Sharp drop in protocol locked funds confirmed.";
    const dollarMatch = c.summary.match(/\$[\d,]+(\.\d+)?/);
    const amount = dollarMatch ? ` (${dollarMatch[0]})` : "";
    return `Protocol locked assets remain secure${amount}. Bridge reserves are steady.`;
  }

  let cleaned = c.summary.split(/\. |\n/)[0]?.trim() || c.summary;
  cleaned = cleaned.replace(/\s*\([^)]*\)/g, "");
  cleaned = cleaned.replace(/\s*—\s*/g, " — ");
  if (!cleaned.endsWith(".")) cleaned += ".";
  return cleaned;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
