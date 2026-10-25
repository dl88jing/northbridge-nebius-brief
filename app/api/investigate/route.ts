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
      offline: body.offline === true,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json(await offlineFallback(e));
  }
}

/** Never show judges a 500: if the live path throws, serve the labeled offline run and say why. */
async function offlineFallback(e: unknown) {
  const message = e instanceof Error ? e.message : "investigate failed";
  const result = await runInvestigation({ reset: true, offline: true });
  return { ...result, run_mode: "degraded" as const, fallbacks: ["The live run hit an unexpected problem, so this is the labeled offline run", ...result.fallbacks], error_detail: message.slice(0, 200) };
}

export async function GET() {
  try {
    return NextResponse.json(await runInvestigation({ reset: true }));
  } catch (e: unknown) {
    return NextResponse.json(await offlineFallback(e));
  }
}
