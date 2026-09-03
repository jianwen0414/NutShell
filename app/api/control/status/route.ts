import { NextResponse } from "next/server";
import {
  getControlState,
  updateControlState,
  type AgentStatus,
  type ExecutionMode,
} from "@/lib/control-state";

export async function GET() {
  const state = getControlState();
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Expected JSON payload with status and/or mode." },
      { status: 400 }
    );
  }

  const updates: { status?: AgentStatus; mode?: ExecutionMode } = {};

  if (body.status !== undefined) {
    if (body.status !== "ARMED" && body.status !== "PAUSED") {
      return NextResponse.json(
        { error: `Invalid status '${body.status}'. Expected 'ARMED' or 'PAUSED'.` },
        { status: 400 }
      );
    }
    updates.status = body.status;
  }

  if (body.mode !== undefined) {
    if (
      body.mode !== "AUTONOMOUS" &&
      body.mode !== "APPROVAL_REQUIRED" &&
      body.mode !== "MONITOR_ONLY"
    ) {
      return NextResponse.json(
        { error: `Invalid mode '${body.mode}'. Expected 'AUTONOMOUS', 'APPROVAL_REQUIRED', or 'MONITOR_ONLY'.` },
        { status: 400 }
      );
    }
    updates.mode = body.mode;
  }

  const newState = updateControlState(updates);
  return NextResponse.json(newState);
}
