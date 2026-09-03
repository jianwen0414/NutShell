/**
 * Telegram Alert Dispatcher for NutShell
 *
 * Sends high-priority push notifications to the operator's phone via Telegram
 * when the autonomous agent is running in MONITOR_ONLY mode and encounters
 * suspicious on-chain anomalies (Truth Score >= 60).
 */

import type { AlertEvent, EvidencePacket, HedgeDecision, VerificationResult } from "@/types";

export interface TelegramAlertPayload {
  jobId: string;
  alert: AlertEvent;
  evidence?: EvidencePacket;
  verification?: VerificationResult;
  decision?: HedgeDecision;
}

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
    `👁 <b>Mode:</b> MONITOR ONLY`,
    `<i>No automatic trade will be executed.</i>`,
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
    `👁 <b>MONITOR ONLY</b>`,
    `• No funds spent.`,
    `• No hedge executed.`,
    `━━━━━━━━━━━━━━━━━━`,
    `🆔 <code>${payload.jobId}</code>`,
  ].filter((line) => line !== null && line !== undefined).join("\n");

  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const appUrl = (configuredAppUrl && isValidTelegramUrl(configuredAppUrl))
    ? configuredAppUrl.replace(/\/$/, "")
    : null;

  const detailsUrl = appUrl ? `${appUrl}/?jobId=${payload.jobId}#stage-02_INVESTIGATE` : "https://basescan.org";
  const hedgeUrl = appUrl ? `${appUrl}/hedge/${payload.jobId}` : "https://basescan.org";

  const isEligibleForManualHedge =
    truthScore >= 70 ||
    payload.decision?.tier === "HEDGE_FULL" ||
    payload.decision?.tier === "HEDGE_SMALL";

  const inlineKeyboard: Array<Array<{ text: string; url: string }>> = [
    [
      {
        text: appUrl ? "🔎 1. View Complete Investigation" : "🔎 1. View Investigation (BaseScan)",
        url: detailsUrl,
      },
    ],
  ];

  if (isEligibleForManualHedge) {
    inlineKeyboard.push([
      {
        text: appUrl ? "🛡 2. Execute Manual Put Option (Thetanuts)" : "🛡 2. Execute Put Option (Thetanuts)",
        url: hedgeUrl,
      },
    ]);
  }

  const replyMarkup = {
    inline_keyboard: inlineKeyboard,
  };

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
