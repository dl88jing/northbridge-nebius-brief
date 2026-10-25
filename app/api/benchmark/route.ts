import { NextResponse } from "next/server";
import { runInvestigation } from "@/lib/agent";
import { hasNebiusKey } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

/**
 * Measured baseline: run the same investigation with every LLM step on Nemotron 3 Ultra,
 * and compare to the routed run. Both sides are real API calls with API-reported token usage.
 */
export async function POST() {
  if (!hasNebiusKey()) {
    return NextResponse.json({ ok: false, error: "Benchmark needs NEBIUS_API_KEY (live Token Factory). Offline mode has no token counts to compare." }, { status: 400 });
  }
  // Sequential on purpose: the baseline reuses the routed run's Tavily results (same sources, 0 extra credits),
  // so the only difference between the two runs is which Nemotron model handles each step.
  const routed = await runInvestigation({ profile: "routed", persist: false, budget_ms: 50_000 });
  const baseline = await runInvestigation({ profile: "all-ultra", persist: false, budget_ms: 60_000 });
  const r = routed.receipt;
  const b = baseline.receipt;
  return NextResponse.json({
    ok: true,
    measured_at: new Date().toISOString(),
    routed: { cost_usd: r.routed_cost_usd, tokens: r.prompt_tokens + r.completion_tokens, calls: r.calls, duration_ms: routed.duration_ms, per_model: r.per_model },
    all_ultra: { cost_usd: b.routed_cost_usd, tokens: b.prompt_tokens + b.completion_tokens, calls: b.calls, duration_ms: baseline.duration_ms, per_model: b.per_model },
    savings_pct: b.routed_cost_usd > 0 ? Math.round((1 - r.routed_cost_usd / b.routed_cost_usd) * 1000) / 10 : null,
    tavily_credits: r.tavily_credits + b.tavily_credits,
    complete: routed.fallbacks.length === 0 && baseline.fallbacks.length === 0,
    fallbacks: { routed: routed.fallbacks, all_ultra: baseline.fallbacks },
    note: "Single paired run; costs = API-reported tokens x Token Factory list price. complete=false means a step fell back, so the comparison is not like-for-like.",
  });
}
