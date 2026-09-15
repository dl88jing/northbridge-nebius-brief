import { NextResponse } from "next/server";
import { resetRuntime } from "@/lib/runtime";
import { getStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function POST() {
  resetRuntime();
  return NextResponse.json({ ok: true, status: getStatus() });
}
