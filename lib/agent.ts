import { loadBills, loadHousehold, getBill } from "./fixtures";
import { evaluateBill } from "./policy";
import { composeDecisionBrief, planInvestigation } from "./nemotron";
import { researchQueryForBill, researchWeb } from "./tavily";
import { getModels, hasNebiusKey, hasTavilyKey, runtimeMode } from "./config";
import { persistInvestigation, resetRuntime } from "./runtime";
import type {
  AgentStep,
  InvestigateResponse,
  InvestigationResult,
} from "./types";

function step(
  kind: AgentStep["kind"],
  title: string,
  detail?: string,
  data?: unknown,
  model?: string
): AgentStep {
  return {
    id: `step-${Math.random().toString(36).slice(2, 9)}`,
    ts: new Date().toISOString(),
    kind,
    title,
    detail,
    data,
    model,
  };
}

export async function runInvestigation(opts?: {
  billIds?: string[];
  reset?: boolean;
  goal?: string;
}): Promise<InvestigateResponse> {
  if (opts?.reset !== false) resetRuntime();

  const household = loadHousehold();
  const models = getModels();
  const mode = runtimeMode();
  const timeline: AgentStep[] = [];
  const results: InvestigationResult[] = [];

  const goal =
    opts?.goal ||
    "Investigate Northbridge household admin anomalies; auto-handle routine bills; escalate with researched briefs.";

  const planned = await planInvestigation(goal);
  timeline.push(
    step(
      "plan",
      "Nemotron investigation plan",
      planned.plan,
      undefined,
      planned.meta.model
    )
  );

  const bills = loadBills().filter((b) =>
    opts?.billIds ? opts.billIds.includes(b.id) : b.status === "due"
  );

  timeline.push(
    step(
      "tool",
      "list_open_bills",
      `Loaded ${bills.length} open bills for ${household.name}`
    )
  );

  for (const bill of bills) {
    const localSteps: AgentStep[] = [];
    localSteps.push(
      step("tool", "parse_bill", `${bill.payee} · $${bill.amount.toFixed(2)}`, {
        bill_id: bill.id,
        due_date: bill.due_date,
        category: bill.category,
      })
    );

    const verdict = evaluateBill(bill);
    localSteps.push(
      step(
        "policy",
        `Policy gate → ${verdict.decision}`,
        verdict.reasons.join("; "),
        verdict
      )
    );

    let research = undefined;
    if (verdict.decision === "HUMAN_REQUIRED" && verdict.needs_research) {
      const q = researchQueryForBill(bill.payee, verdict.rule_ids.join(" "));
      localSteps.push(step("research", "Tavily research query", q));
      research = await researchWeb(q);
      localSteps.push(
        step(
          "research",
          `Research via ${research.source}`,
          `${research.results.length} hits`,
          research
        )
      );
    }

    if (verdict.decision === "AUTO") {
      localSteps.push(
        step(
          "action",
          "mark_auto_handled",
          `Quietly prepared ${bill.payee} — no human ping`
        )
      );
      const item: InvestigationResult = {
        bill_id: bill.id,
        payee: bill.payee,
        decision: "AUTO",
        reasons: verdict.reasons,
        funding_ok: verdict.funding_ok,
        steps: localSteps,
        action: "auto_handled",
      };
      results.push(item);
      timeline.push(...localSteps);
      continue;
    }

    const { brief, meta } = await composeDecisionBrief(bill, verdict, research);
    localSteps.push(
      step(
        "llm",
        "Nemotron decision brief",
        brief.headline,
        brief,
        meta.model
      )
    );
    localSteps.push(
      step("brief", "notify_human", brief.speakable, {
        recommended_action: brief.recommended_action,
      })
    );
    localSteps.push(
      step("action", "escalate", `HUMAN_REQUIRED · ${bill.payee}`)
    );

    const item: InvestigationResult = {
      bill_id: bill.id,
      payee: bill.payee,
      decision: "HUMAN_REQUIRED",
      reasons: verdict.reasons,
      funding_ok: verdict.funding_ok,
      research,
      brief,
      steps: localSteps,
      action: "escalated",
    };
    results.push(item);
    timeline.push(...localSteps);
  }

  const response: InvestigateResponse = {
    ok: true,
    mode,
    models: { fast: models.fast, reason: models.reason },
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

  persistInvestigation(response);
  return response;
}

export async function investigateOne(billId: string) {
  const bill = getBill(billId);
  if (!bill) throw new Error(`Unknown bill ${billId}`);
  return runInvestigation({ billIds: [billId], reset: false });
}
