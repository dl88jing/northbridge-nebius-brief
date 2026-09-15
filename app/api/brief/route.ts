import { NextRequest, NextResponse } from "next/server";
import { loadRuntime } from "@/lib/runtime";
import { investigateOne } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("bill_id");
  const runtime = loadRuntime();
  if (id && runtime.briefs[id]) {
    return NextResponse.json({ ok: true, brief: runtime.briefs[id] });
  }
  return NextResponse.json({
    ok: true,
    briefs: runtime.briefs,
    needs_decision: runtime.needs_decision,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.bill_id) {
    return NextResponse.json({ ok: false, error: "bill_id required" }, { status: 400 });
  }
  const result = await investigateOne(body.bill_id);
  return NextResponse.json(result);
}
