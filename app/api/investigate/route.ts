import { NextRequest, NextResponse } from "next/server";
import { runInvestigation } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await runInvestigation({
      billIds: body.billIds,
      reset: body.reset !== false,
      goal: body.goal,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "investigate failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const result = await runInvestigation({ reset: true });
  return NextResponse.json(result);
}
