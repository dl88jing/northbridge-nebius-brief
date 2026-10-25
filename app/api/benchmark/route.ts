import { NextResponse } from "next/server";
import { runInvestigation } from "@/lib/agent";
import { hasNebiusKey } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Measured baseline: run the same investigation with every LLM step on Nemotron 3 Ultra,
 * and compare to the routed run. Both sides are real API calls with API-reported token usage.
 */
export async function POST() {
  if (!hasNebiusKey()) {
    return NextResponse.json({ ok: false, error: "Benchmark needs NEBIUS_API_KEY (live Token Factory). Offline mode has no token counts to compare." }, { status: 400 });
  }
  const [routed, baseline] = await Promise.all([
    runInvestigation({ profile: "routed", persist: false }),
    runInvestigation({ profile: "all-ultra", persist: false }),
  ]);
  const r = routed.receipt;
  const b = baseline.receipt;
  return NextResponse.json({
    ok: true,
    measured_at: new Date().toISOString(),
    routed: { cost_usd: r.routed_cost_usd, tokens: r.prompt_tokens + r.completion_tokens, calls: r.calls, duration_ms: routed.duration_ms, per_model: r.per_model },
    all_ultra: { cost_usd: b.routed_cost_usd, tokens: b.prompt_tokens + b.completion_tokens, calls: b.calls, duration_ms: baseline.duration_ms, per_model: b.per_model },
    savings_pct: b.routed_cost_usd > 0 ? Math.round((1 - r.routed_cost_usd / b.routed_cost_usd) * 1000) / 10 : null,
    note: "Single paired run; costs = API-reported tokens x Token Factory list price.",
  });
}
