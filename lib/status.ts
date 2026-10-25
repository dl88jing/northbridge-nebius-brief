import {
  loadBills,
  loadDues,
  loadFunding,
  loadHousehold,
  loadPolicy,
} from "./fixtures";
import { evaluateBill } from "./policy";
import { getModels, hasNebiusKey, hasTavilyKey, runtimeMode } from "./config";
import { loadRuntime } from "./runtime";

export function getStatus() {
  const household = loadHousehold();
  const bills = loadBills();
  const funding = loadFunding();
  const dues = loadDues();
  const policy = loadPolicy();
  const runtime = loadRuntime();
  const models = getModels();

  const preview = bills.map((b) => {
    const v = evaluateBill(b);
    return {
      id: b.id,
      payee: b.payee,
      amount: b.amount,
      due_date: b.due_date,
      category: b.category,
      decision: v.decision,
      reasons: v.reasons,
      handled: runtime.handled.includes(b.id),
      needs_decision: runtime.needs_decision.includes(b.id),
    };
  });

  return {
    ok: true,
    product: "Northbridge Brief",
    household,
    mode: runtimeMode(),
    token_factory: hasNebiusKey(),
    tavily: hasTavilyKey(),
    models,
    policy: { version: policy.version, mode: policy.mode },
    funding,
    dues,
    bills: preview,
    runtime: {
      handled: runtime.handled,
      needs_decision: runtime.needs_decision,
      brief_ids: Object.keys(runtime.briefs),
      last_summary: runtime.last_run?.summary || null,
    },
    briefs: runtime.briefs,
    last_timeline: runtime.last_run?.timeline || [],
    last_results: runtime.last_run?.results || [],
    last_receipt: runtime.last_run?.receipt || null,
    last_duration_ms: runtime.last_run?.duration_ms || null,
  };
}
