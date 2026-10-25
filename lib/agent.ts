import { loadBills, loadHousehold, getBill } from "./fixtures";
import { evaluateBill } from "./policy";
import { composeDecisionBrief, needsUltraReview, planInvestigation, ultraReview } from "./nemotron";
import { researchPlanForBill, researchWeb } from "./tavily";
import { getModels, hasNebiusKey, hasTavilyKey, runtimeMode, withOffline } from "./config";
import { persistInvestigation, resetRuntime } from "./runtime";
import { buildReceipt } from "./receipt";
import type { AgentStep, InvestigateResponse, InvestigationResult, LlmUsage } from "./types";
import type { LlmCallMeta } from "./nemotron";

let seq = 0;
function step(kind: AgentStep["kind"], title: string, detail?: string, data?: unknown, meta?: LlmCallMeta | { model?: string }, ms?: number): AgentStep {
  const m = meta as LlmCallMeta | undefined;
  return {
    id: `step-${Date.now().toString(36)}-${(seq++).toString(36)}`,
    ts: new Date().toISOString(),
    kind,
    title,
    detail: m?.error ? `${detail ?? ""}\n(live call failed: ${m.error}; fell back)` : detail,
    data,
    model: meta?.model,
    usage: m?.usage,
    ms: ms ?? m?.usage?.latency_ms,
  };
}

/**
 * profile "routed"    = Nano plans, Super writes briefs, Ultra reviews only high-stakes escalations (default)
 * profile "all-ultra" = every LLM step on Ultra (measured baseline for the cost comparison)
 */
/** Short, judge-friendly reason; the raw message stays in the trace step detail. */
function why(err?: string): string {
  const e = (err || "").toLowerCase();
  if (/time|abort|deadline|budget/.test(e)) return "timed out";
  if (/credit|402|432|433|balance|quota/.test(e)) return "out of credits";
  if (/429|rate/.test(e)) return "rate limited";
  if (/401|403|auth/.test(e)) return "key rejected";
  if (/json/.test(e)) return "reply was not valid JSON";
  return "unavailable";
}

type RunOpts = {
  billIds?: string[];
  reset?: boolean;
  goal?: string;
  profile?: "routed" | "all-ultra";
  persist?: boolean;
  /** Run the labeled offline path even when keys are set (client-side fallback). */
  offline?: boolean;
  /** Wall-clock budget for the whole run; every live call is bounded by what is left. */
  budget_ms?: number;
};

export async function runInvestigation(opts?: RunOpts): Promise<InvestigateResponse> {
  if (opts?.offline) return withOffline(() => runInvestigationInner(opts));
  return runInvestigationInner(opts);
}

async function runInvestigationInner(opts?: RunOpts): Promise<InvestigateResponse> {
  const t0 = Date.now();
  const deadline = t0 + (opts?.budget_ms ?? 48_000);
  const left = (cap: number) => Math.max(0, Math.min(cap, deadline - Date.now() - 1500));
  const fallbacks: string[] = [];
  const started_at = new Date().toISOString();
  if (opts?.reset !== false && opts?.persist !== false) resetRuntime();
  const profile = opts?.profile || "routed";
  const household = loadHousehold();
  const models = getModels();
  const pick = (m: string) => (profile === "all-ultra" ? models.ultra : m);
  const usages: LlmUsage[] = [];
  let credits = 0;
  const timeline: AgentStep[] = [];
  const results: InvestigationResult[] = [];
  const goal = opts?.goal || "Investigate Northbridge household admin anomalies; auto-handle routine bills; escalate with researched briefs.";

  const planned = await planInvestigation(goal, pick(models.fast), left(12_000));
  if (planned.meta.mode === "fallback") fallbacks.push(`Plan: Nemotron Nano ${why(planned.meta.error)}, so a template plan was used`);
  if (planned.meta.usage) usages.push(planned.meta.usage);
  timeline.push(step("plan", "Investigation plan", planned.plan, undefined, planned.meta));

  const bills = loadBills().filter((b) => (opts?.billIds ? opts.billIds.includes(b.id) : b.status === "due"));
  timeline.push(step("tool", "list_open_bills", `Loaded ${bills.length} open bills for ${household.name}`, undefined, { model: "deterministic tool" }));

  // Bills are independent, so they are investigated in parallel; order is restored afterwards.
  const perBill = await Promise.all(
    bills.map(async (bill) => {
      const localSteps: AgentStep[] = [];
      const u: LlmUsage[] = [];
      let c = 0;
      const verdict = evaluateBill(bill);
      localSteps.push(step("policy", `Policy gate: ${bill.payee} → ${verdict.decision}`, verdict.reasons.join("; "), verdict, { model: "deterministic rules (no LLM)" }));

      if (verdict.decision === "AUTO") {
        localSteps.push(step("action", "mark_auto_handled", `Quietly prepared ${bill.payee}. No human ping, no model tokens spent.`));
        const r: InvestigationResult = { bill_id: bill.id, payee: bill.payee, decision: "AUTO", reasons: verdict.reasons, funding_ok: verdict.funding_ok, steps: localSteps, action: "auto_handled" };
        return { r, u, c };
      }

      let research = undefined;
      if (verdict.needs_research) {
        const plan = researchPlanForBill(bill, verdict.rule_ids);
        research = await researchWeb(plan);
        c += research.credits ?? 0;
        const live = research.source === "tavily";
        if (research.fallback) fallbacks.push(`${bill.payee}: web research ${why(research.error)}, so labeled offline sources were used`);
        const title = live
          ? `Tavily search + extract (${research.results.length} sources, ${research.extracted_count ?? 0} extracted${research.cached ? ", cached" : ""})`
          : research.fallback
            ? "Research: FALLBACK offline fixture (Tavily unavailable)"
            : "Research: OFFLINE fixture (no Tavily call)";
        localSteps.push(
          step(
            "research",
            title,
            `Q: ${plan.query}${research.error ? `\n(${research.error})` : ""}${research.extract_error ? `\n(extract skipped: ${research.extract_error})` : ""}`,
            research,
            { model: live ? (research.cached ? "Tavily · cached (0 new credits)" : `Tavily · ${research.credits ?? 0} credits`) : "offline fixture" },
            research.cached ? undefined : (research.search_ms ?? 0) + (research.extract_ms ?? 0) || undefined
          )
        );
      }

      const { brief, meta } = await composeDecisionBrief(bill, verdict, research, pick(models.reason), left(25_000));
      if (meta.retry_usage) u.push(meta.retry_usage);
      if (meta.usage) u.push(meta.usage);
      if (meta.mode === "fallback") fallbacks.push(`${bill.payee}: Nemotron brief ${why(meta.error)}, so a labeled template was used`);
      localSteps.push(step("llm", brief.mode === "fallback" ? "Decision brief (FALLBACK template)" : "Decision brief", brief.headline, brief, meta));

      if (needsUltraReview(bill, verdict)) {
        const budget = left(20_000);
        const ur = budget >= 6000 && brief.mode === "live"
          ? await ultraReview(bill, brief, research, models.ultra, budget)
          : { meta: { mode: hasNebiusKey() ? ("fallback" as const) : ("offline" as const), model: "skipped", used_token_factory: false, error: hasNebiusKey() ? (brief.mode !== "live" ? "brief was a fallback" : "out of time budget") : undefined } };
        if (ur.meta.usage) u.push(ur.meta.usage);
        const review = "review" in ur ? ur.review : undefined;
        if (review) brief.ultra_review = review;
        if (!review && hasNebiusKey()) fallbacks.push(`${bill.payee}: Ultra second-opinion skipped (${ur.meta.error === "brief was a fallback" ? "brief was a fallback" : why(ur.meta.error)})`);
        localSteps.push(
          step(
            "llm",
            review ? `Ultra escalation review → ${review.verdict}` : hasNebiusKey() ? "Ultra escalation review (skipped, see note)" : "Ultra escalation review (skipped offline)",
            review
              ? `${review.reason}${review.unsupported_claims.length ? `\nUnsupported: ${review.unsupported_claims.join(" | ")}` : ""}`
              : hasNebiusKey()
                ? "The brief above is still shown; it just lacks the second-opinion check."
                : "Runs only in live mode on high-stakes escalations.",
            review,
            ur.meta
          )
        );
      }
      localSteps.push(step("brief", "notify_human", brief.speakable, { recommended_action: brief.recommended_action }));
      const r: InvestigationResult = { bill_id: bill.id, payee: bill.payee, decision: "HUMAN_REQUIRED", reasons: verdict.reasons, funding_ok: verdict.funding_ok, research, brief, steps: localSteps, action: "escalated" };
      return { r, u, c };
    })
  );
  for (const { r, u, c } of perBill) {
    results.push(r);
    usages.push(...u);
    credits += c;
    timeline.push(...r.steps);
  }

  const response: InvestigateResponse = {
    ok: true,
    mode: runtimeMode(),
    run_mode: runtimeMode() === "offline" ? "offline" : runtimeMode() === "partial" || fallbacks.length ? "degraded" : "live",
    fallbacks,
    models: { fast: models.fast, reason: models.reason, ultra: models.ultra },
    receipt: buildReceipt(usages, credits, models.ultra),
    started_at,
    duration_ms: Date.now() - t0,
    token_factory: hasNebiusKey(),
    tavily: hasTavilyKey(),
    household: household.name,
    summary: {
      auto: results.filter((r) => r.action === "auto_handled").length,
      escalated: results.filter((r) => r.action === "escalated").length,
      investigated: results.length,
    },
    results,
    timeline,
  };
  if (opts?.persist !== false) persistInvestigation(response);
  return response;
}

export async function investigateOne(billId: string) {
  const bill = getBill(billId);
  if (!bill) throw new Error(`Unknown bill ${billId}`);
  return runInvestigation({ billIds: [billId], reset: false });
}
