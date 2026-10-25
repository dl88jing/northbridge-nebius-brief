import { loadBills, loadHousehold, getBill } from "./fixtures";
import { evaluateBill } from "./policy";
import { composeDecisionBrief, needsUltraReview, planInvestigation, ultraReview } from "./nemotron";
import { researchPlanForBill, researchWeb } from "./tavily";
import { getModels, hasNebiusKey, hasTavilyKey, runtimeMode } from "./config";
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
export async function runInvestigation(opts?: {
  billIds?: string[];
  reset?: boolean;
  goal?: string;
  profile?: "routed" | "all-ultra";
  persist?: boolean;
}): Promise<InvestigateResponse> {
  const t0 = Date.now();
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

  const planned = await planInvestigation(goal, pick(models.fast));
  if (planned.meta.usage) usages.push(planned.meta.usage);
  timeline.push(step("plan", "Investigation plan", planned.plan, undefined, planned.meta));

  const bills = loadBills().filter((b) => (opts?.billIds ? opts.billIds.includes(b.id) : b.status === "due"));
  timeline.push(step("tool", "list_open_bills", `Loaded ${bills.length} open bills for ${household.name}`, undefined, { model: "deterministic tool" }));

  for (const bill of bills) {
    const localSteps: AgentStep[] = [];
    const verdict = evaluateBill(bill);
    localSteps.push(step("policy", `Policy gate: ${bill.payee} → ${verdict.decision}`, verdict.reasons.join("; "), verdict, { model: "deterministic rules (no LLM)" }));

    if (verdict.decision === "AUTO") {
      localSteps.push(step("action", "mark_auto_handled", `Quietly prepared ${bill.payee}. No human ping, no model tokens spent.`));
      results.push({ bill_id: bill.id, payee: bill.payee, decision: "AUTO", reasons: verdict.reasons, funding_ok: verdict.funding_ok, steps: localSteps, action: "auto_handled" });
      timeline.push(...localSteps);
      continue;
    }

    let research = undefined;
    if (verdict.needs_research) {
      const plan = researchPlanForBill(bill, verdict.rule_ids);
      research = await researchWeb(plan);
      credits += research.credits ?? 0;
      const live = research.source === "tavily";
      localSteps.push(
        step(
          "research",
          live ? `Tavily search + extract (${research.results.length} sources, ${research.extracted_count ?? 0} extracted)` : "Research: OFFLINE fixture (no Tavily call)",
          `Q: ${plan.query}${research.error ? `\n(${research.error})` : ""}`,
          research,
          { model: live ? `Tavily · ${research.credits ?? 0} credits` : "offline fixture" },
          (research.search_ms ?? 0) + (research.extract_ms ?? 0) || undefined
        )
      );
    }

    const { brief, meta } = await composeDecisionBrief(bill, verdict, research, pick(models.reason));
    if (meta.usage) usages.push(meta.usage);
    localSteps.push(step("llm", "Decision brief", brief.headline, brief, meta));

    if (needsUltraReview(bill, verdict)) {
      const ur = await ultraReview(bill, brief, research, models.ultra);
      if (ur.meta.usage) usages.push(ur.meta.usage);
      if (ur.review) brief.ultra_review = ur.review;
      localSteps.push(
        step(
          "llm",
          ur.review ? `Ultra escalation review → ${ur.review.verdict}` : "Ultra escalation review (skipped offline)",
          ur.review ? `${ur.review.reason}${ur.review.unsupported_claims.length ? `\nUnsupported: ${ur.review.unsupported_claims.join(" | ")}` : ""}` : "Runs only in live mode on high-stakes escalations.",
          ur.review,
          ur.meta
        )
      );
    }
    localSteps.push(step("brief", "notify_human", brief.speakable, { recommended_action: brief.recommended_action }));
    results.push({ bill_id: bill.id, payee: bill.payee, decision: "HUMAN_REQUIRED", reasons: verdict.reasons, funding_ok: verdict.funding_ok, research, brief, steps: localSteps, action: "escalated" });
    timeline.push(...localSteps);
  }

  const response: InvestigateResponse = {
    ok: true,
    mode: runtimeMode(),
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
