import { NextResponse } from "next/server";
import { isTelegramConfigured, sendTelegramTestPing } from "@/lib/telegram";

export async function GET() {
  const configured = isTelegramConfigured();
  return NextResponse.json({
    configured,
    chatIdConfigured: Boolean(process.env.TELEGRAM_CHAT_ID),
    botTokenConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await sendTelegramTestPing({
    token: typeof body?.token === "string" ? body.token : undefined,
    chatId: typeof body?.chatId === "string" ? body.chatId : undefined,
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, messageId: res.messageId });
}
