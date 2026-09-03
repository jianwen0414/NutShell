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

  const claimSnippet = payload.alert.rawText.length > 250
    ? `${payload.alert.rawText.slice(0, 247)}...`
    : payload.alert.rawText;

  // Compile on-chain investigation checks
  const evidenceLines: string[] = [];
  if (payload.evidence?.checks && payload.evidence.checks.length > 0) {
    for (const c of payload.evidence.checks) {
      let icon = "⚪";
      let statusLabel = "INCONCLUSIVE";
      if (c.stance === "CORROBORATES") {
        icon = "🔴";
        statusLabel = "SUSPICIOUS";
      } else if (c.stance === "CONTRADICTS") {
        icon = "🟢";
        statusLabel = "NORMAL";
      }
      evidenceLines.push(`${icon} <b>${escapeHtml(c.title)}</b> — <i>${statusLabel}</i>\n${escapeHtml(c.summary)}`);
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

  const consensusSummary = isCritical
    ? "🚨 <b>Critical on-chain exploit confirmed</b> by Triad models and Base RPC state."
    : "⚠️ <b>Evidence is mixed.</b> The agent cannot confirm the reported exploit.";

  const html = [
    `<b>${headerIcon} NUTSHELL DEFI GUARDIAN</b>`,
    `<b>${severityTitle}</b>`,
    ``,
    `👁 <b>Mode:</b> MONITOR ONLY`,
    `<i>No automatic trade will be executed.</i>`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `<b>📊 VERDICT</b>`,
    ``,
    `• <b>Truth Score:</b> <code>${truthScore} / 100</code>`,
    `• <b>Recommended Action:</b> ${tierIcon} <b>${payload.decision?.tier ?? "WATCH"}</b>`,
    `• <b>Network:</b> Base Mainnet`,
    ``,
    `${consensusSummary}`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `<b>📋 CLAIM</b>`,
    `<blockquote>${escapeHtml(claimSnippet)}</blockquote>`,
    ``,
    evidenceLines.length > 0
      ? [
          `━━━━━━━━━━━━━━━━━━`,
          ``,
          `<b>🔍 ON-CHAIN INVESTIGATION</b>`,
          ``,
          evidenceLines.join("\n\n"),
          ``,
        ].join("\n")
      : ``,
    modelLines.length > 0
      ? [
          `━━━━━━━━━━━━━━━━━━`,
          ``,
          `<b>🤖 AI TRIAD</b>`,
          ``,
          modelLines.join("\n"),
          ``,
        ].join("\n")
      : ``,
    `━━━━━━━━━━━━━━━━━━`,
    ``,
    `<b>🛡 ACTION</b>`,
    ``,
    `👁 <b>MONITOR ONLY</b>`,
    `• No funds spent.`,
    `• No hedge executed.`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `🆔 <code>${payload.jobId}</code>`,
  ].filter(Boolean).join("\n");

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
