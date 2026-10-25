import { getModels, hasNebiusKey } from "./config";
import { CallError, chat, extractJson } from "./llm";
import type { Bill, DecisionBrief, LlmUsage, ResearchBundle, UltraReview } from "./types";
import type { PolicyVerdict } from "./policy";

export type LlmCallMeta = {
  mode: "live" | "offline" | "fallback";
  model: string;
  used_token_factory: boolean;
  usage?: LlmUsage;
  /** Usage of an earlier attempt whose reply could not be parsed (still billed, so still counted). */
  retry_usage?: LlmUsage;
  error?: string;
};

export function citationsFor(research?: ResearchBundle) {
  return (research?.results || []).slice(0, 5).map((r, i) => ({ n: i + 1, title: r.title, url: r.url }));
}

function offlineBrief(bill: Bill, verdict: PolicyVerdict, research?: ResearchBundle, reason = "offline"): { brief: DecisionBrief; meta: LlmCallMeta } {
  const model = "template (no model call)";
  const citations = citationsFor(research);
  const research_summary = research?.results?.length
    ? research.results.slice(0, 3).map((r, i) => `[${i + 1}] ${r.title}: ${r.snippet}`).join(" ")
    : undefined;
  const headline = verdict.rule_ids.includes("duplicate_charge")
    ? `Possible duplicate ${bill.payee} charge`
    : verdict.rule_ids.includes("amount_out_of_band")
      ? `${bill.payee} amount looks unexpected`
      : `${bill.payee} needs a human decision`;
  const recommended =
    bill.category === "medical"
      ? "Confirm insurance remittance (EOB) before paying the full estimate."
      : verdict.rule_ids.includes("duplicate_charge")
        ? "Hold payment and confirm only one draft will clear for this payee."
        : verdict.rule_ids.includes("amount_out_of_band")
          ? "Review plan change / cancel or accept the new price before autopay."
          : "Review the brief and approve or snooze.";
  return {
    brief: {
      bill_id: bill.id,
      headline,
      situation: `${bill.payee} is due ${bill.due_date} for $${bill.amount.toFixed(2)}. ${bill.notes}`,
      why_it_matters: verdict.reasons.join(" · "),
      recommended_action: recommended,
      questions_for_humans: ["Do you recognize this charge?", "Should Northbridge proceed, hold, or negotiate?"],
      research_summary,
      speakable: `Avery, Morgan: ${headline}. ${recommended}`,
      model_used: model,
      mode: "offline",
      citations,
    },
    meta: { mode: reason === "offline" ? "offline" : "fallback", model, used_token_factory: false, error: reason === "offline" ? undefined : reason },
  };
}

function sourcesBlock(research?: ResearchBundle): string {
  if (!research?.results?.length) return "(no sources)";
  return research.results
    .slice(0, 5)
    .map((r, i) => `[${i + 1}] ${r.title} <${r.url}>\n${r.extract || r.snippet}`)
    .join("\n\n");
}

export async function planInvestigation(goal: string, model?: string, timeout_ms = 15_000, billContext = ""): Promise<{ plan: string; meta: LlmCallMeta }> {
  const m = model || getModels().fast;
  if (!hasNebiusKey()) {
    return {
      plan: `Offline plan for: ${goal}\n1) List dues 2) Policy gate 3) Research anomalies 4) Compose cited briefs 5) Auto-handle routine items.`,
      meta: { mode: "offline", model: "template (no model call)", used_token_factory: false },
    };
  }
  try {
    const r = await chat(
      m,
      [
        {
          role: "system",
          content:
            "You plan the nightly bill review for a two-person household (Avery and Morgan). Available tools: policy_gate (deterministic rules: duplicates, amount out of expected band, medical/tax/legal sensitivity, funding), web_research (Tavily search + extract), write_brief (cited decision brief), ultra_review (second opinion on high-stakes briefs), mark_auto_handled. You do NOT decide outcomes: policy_gate decides what is auto-handled or escalated, so never say a bill will be paid or auto-handled. Output a numbered plan of at most 5 short steps, one line each: step 1 runs policy_gate on every bill, then name the specific bills worth a closer look and what to check (e.g. possible duplicate, price change, insurance). Household bills only. No preamble.",
        },
        { role: "user", content: `GOAL: ${goal}\n\nOPEN BILLS:\n${billContext || "(not loaded)"}` },
      ],
      { max_tokens: 400, timeout_ms }
    );
    return { plan: r.text.trim() || "Investigate anomalies.", meta: { mode: "live", model: m, used_token_factory: true, usage: r.usage } };
  } catch (e) {
    return {
      plan: `Fallback plan (Token Factory did not answer in time): ${goal}\n1) List dues 2) Policy gate 3) Research anomalies 4) Compose cited briefs 5) Auto-handle routine items.`,
      meta: { mode: "fallback", model: m, used_token_factory: false, error: e instanceof Error ? e.message : "plan failed" },
    };
  }
}

export async function composeDecisionBrief(
  bill: Bill,
  verdict: PolicyVerdict,
  research?: ResearchBundle,
  model?: string,
  timeout_ms = 25_000
): Promise<{ brief: DecisionBrief; meta: LlmCallMeta }> {
  if (!hasNebiusKey()) return offlineBrief(bill, verdict, research);
  const m = model || getModels().reason;
  const system = `You are Northbridge Brief, a quiet household ops agent for Avery and Morgan Quinn.
Write a crisp decision brief. Never invent amounts or facts. Use only the bill, the policy verdict and the numbered SOURCES.
Cite sources inline as [n]. If sources do not support a claim, say so.
Return ONLY a JSON object with keys: headline, situation, why_it_matters, recommended_action, questions_for_humans (array of 2 strings), speakable (one or two sentences addressed to Avery and Morgan), research_summary (2-3 sentences with [n] citations).`;
  const user = `BILL:\n${JSON.stringify(bill)}\n\nPOLICY VERDICT:\n${JSON.stringify({ decision: verdict.decision, reasons: verdict.reasons })}\n\nSOURCES:\n${sourcesBlock(research)}`;
  const t0 = Date.now();
  let retry_usage: LlmUsage | undefined;
  try {
    let r = await chat(m, [{ role: "system", content: system }, { role: "user", content: user }], { temperature: 0.3, max_tokens: 1400, timeout_ms });
    let parsed = extractJson<Partial<DecisionBrief>>(r.text);
    const leftMs = timeout_ms - (Date.now() - t0);
    if (!parsed && leftMs > 8000) {
      // One repair attempt: same prompt, plus a reminder that only a JSON object is accepted.
      retry_usage = r.usage;
      r = await chat(
        m,
        [
          { role: "system", content: system },
          { role: "user", content: user },
          { role: "assistant", content: r.text.slice(0, 4000) },
          { role: "user", content: "That reply was not a valid JSON object. Reply again with ONLY the JSON object, no prose, no code fences." },
        ],
        { temperature: 0.1, max_tokens: 1400, timeout_ms: leftMs - 500 }
      );
      parsed = extractJson<Partial<DecisionBrief>>(r.text);
    }
    if (!parsed) throw new CallError(`model reply was not JSON (finish: ${r.finish_reason ?? "?"})`, r.usage);
    const brief: DecisionBrief = {
      bill_id: bill.id,
      headline: parsed.headline || `${bill.payee} needs review`,
      situation: parsed.situation || bill.notes,
      why_it_matters: parsed.why_it_matters || verdict.reasons.join("; "),
      recommended_action: parsed.recommended_action || "Review before paying",
      questions_for_humans: Array.isArray(parsed.questions_for_humans) ? parsed.questions_for_humans.map(String) : ["Approve, hold, or renegotiate?"],
      research_summary: parsed.research_summary,
      speakable: parsed.speakable || `Avery, Morgan: please review ${bill.payee} for $${bill.amount.toFixed(2)}.`,
      model_used: m,
      mode: "live",
      citations: citationsFor(research),
    };
    return { brief, meta: { mode: "live", model: m, used_token_factory: true, usage: r.usage, retry_usage } };
  } catch (e) {
    const fb = offlineBrief(bill, verdict, research, e instanceof Error ? e.message : "brief failed");
    fb.brief.mode = "fallback";
    fb.brief.model_used = "template (live call failed)";
    if (e instanceof CallError && e.usage) fb.meta.usage = e.usage;
    fb.meta.retry_usage = retry_usage;
    return fb;
  }
}

/** High-stakes escalations get a second look from Nemotron 3 Ultra: does every claim trace to a source? */
export function needsUltraReview(bill: Bill, verdict: PolicyVerdict): boolean {
  const sensitive = ["medical", "tax", "legal"].includes(bill.category);
  return verdict.decision === "HUMAN_REQUIRED" && (verdict.rule_ids.length >= 2 || sensitive || bill.amount >= 500);
}

export async function ultraReview(
  bill: Bill,
  brief: DecisionBrief,
  research?: ResearchBundle,
  model?: string,
  timeout_ms = 25_000
): Promise<{ review?: UltraReview; meta: LlmCallMeta }> {
  const m = model || getModels().ultra;
  if (!hasNebiusKey() || brief.mode !== "live") {
    return { meta: { mode: "offline", model: "skipped (offline)", used_token_factory: false } };
  }
  const system = `You are the Northbridge escalation reviewer. Check a household decision brief against its numbered SOURCES and the BILL.
List any claim not supported by the bill or sources. Return ONLY JSON: {"verdict":"confirm"|"revise","unsupported_claims":[string],"final_recommendation":string,"reason":string}.`;
  const user = `BILL:\n${JSON.stringify(bill)}\n\nBRIEF:\n${JSON.stringify({ headline: brief.headline, situation: brief.situation, recommended_action: brief.recommended_action, research_summary: brief.research_summary })}\n\nSOURCES:\n${sourcesBlock(research)}`;
  try {
    const r = await chat(m, [{ role: "system", content: system }, { role: "user", content: user }], { temperature: 0.1, max_tokens: 900, timeout_ms });
    const p = extractJson<Partial<UltraReview>>(r.text);
    if (!p) throw new CallError(`reviewer reply was not JSON (finish: ${r.finish_reason ?? "?"})`, r.usage);
    return {
      review: {
        verdict: p.verdict === "revise" ? "revise" : "confirm",
        unsupported_claims: Array.isArray(p.unsupported_claims) ? p.unsupported_claims.map(String) : [],
        final_recommendation: p.final_recommendation || brief.recommended_action,
        reason: p.reason || "",
        model: m,
      },
      meta: { mode: "live", model: m, used_token_factory: true, usage: r.usage },
    };
  } catch (e) {
    return {
      meta: { mode: "fallback", model: m, used_token_factory: false, error: e instanceof Error ? e.message : "review failed", usage: e instanceof CallError ? e.usage : undefined },
    };
  }
}
