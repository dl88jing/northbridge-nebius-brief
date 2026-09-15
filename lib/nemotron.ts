import OpenAI from "openai";
import { getModels, getNebiusKey, hasNebiusKey } from "./config";
import type { Bill, DecisionBrief, ResearchBundle } from "./types";
import type { PolicyVerdict } from "./policy";

export type LlmCallMeta = {
  mode: "live" | "offline";
  model: string;
  used_token_factory: boolean;
};

function offlineBrief(
  bill: Bill,
  verdict: PolicyVerdict,
  research?: ResearchBundle
): { brief: DecisionBrief; meta: LlmCallMeta } {
  const model = getModels().reason + " (offline-sim)";
  const research_summary = research?.results?.length
    ? research.results.map((r) => `${r.title}: ${r.snippet}`).join(" ")
    : undefined;

  const headline =
    verdict.rule_ids.includes("duplicate_charge")
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

  const brief: DecisionBrief = {
    bill_id: bill.id,
    headline,
    situation: `${bill.payee} is due ${bill.due_date} for $${bill.amount.toFixed(2)}. ${bill.notes}`,
    why_it_matters: verdict.reasons.join(" · "),
    recommended_action: recommended,
    questions_for_humans: [
      "Do you recognize this charge?",
      "Should Northbridge proceed, hold, or negotiate?",
    ],
    research_summary,
    speakable: `Avery, Morgan — ${headline}. ${recommended}`,
    model_used: model,
    mode: "offline",
  };
  return {
    brief,
    meta: { mode: "offline", model, used_token_factory: false },
  };
}

export async function composeDecisionBrief(
  bill: Bill,
  verdict: PolicyVerdict,
  research?: ResearchBundle
): Promise<{ brief: DecisionBrief; meta: LlmCallMeta }> {
  if (!hasNebiusKey()) {
    return offlineBrief(bill, verdict, research);
  }

  const models = getModels();
  const client = new OpenAI({
    apiKey: getNebiusKey(),
    baseURL: models.baseUrl,
  });

  const system = `You are Northbridge Brief, a quiet household ops agent for Avery and Morgan Quinn.
Write crisp decision briefs. Never invent amounts. Pseudonyms only. Escalate-only tone.
Return STRICT JSON with keys: headline, situation, why_it_matters, recommended_action, questions_for_humans (array of strings), speakable, research_summary.`;

  const user = JSON.stringify(
    {
      bill,
      policy_verdict: verdict,
      research: research || null,
    },
    null,
    2
  );

  try {
    const resp = await client.chat.completions.create({
      model: models.reason,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });

    const raw = resp.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw) as Partial<DecisionBrief>;
    const brief: DecisionBrief = {
      bill_id: bill.id,
      headline: parsed.headline || `${bill.payee} needs review`,
      situation: parsed.situation || bill.notes,
      why_it_matters: parsed.why_it_matters || verdict.reasons.join("; "),
      recommended_action:
        parsed.recommended_action || "Review before paying",
      questions_for_humans: parsed.questions_for_humans || [
        "Approve, hold, or renegotiate?",
      ],
      research_summary: parsed.research_summary,
      speakable:
        parsed.speakable ||
        `Avery, Morgan — please review ${bill.payee} for $${bill.amount.toFixed(2)}.`,
      model_used: models.reason,
      mode: "live",
    };
    return {
      brief,
      meta: {
        mode: "live",
        model: models.reason,
        used_token_factory: true,
      },
    };
  } catch {
    // Fall back to offline brief if live call fails
    const fallback = offlineBrief(bill, verdict, research);
    fallback.brief.headline = `[fallback] ${fallback.brief.headline}`;
    fallback.meta.model = `${fallback.meta.model} (live-error-fallback)`;
    return fallback;
  }
}

export async function planInvestigation(
  goal: string
): Promise<{ plan: string; meta: LlmCallMeta }> {
  const models = getModels();
  if (!hasNebiusKey()) {
    return {
      plan: `Offline plan for: ${goal}. 1) List dues 2) Evaluate policy 3) Research anomalies via Tavily/fixtures 4) Compose briefs with Nemotron reasoning pattern 5) Auto-handle routine items.`,
      meta: {
        mode: "offline",
        model: models.fast + " (offline-sim)",
        used_token_factory: false,
      },
    };
  }

  const client = new OpenAI({
    apiKey: getNebiusKey(),
    baseURL: models.baseUrl,
  });

  try {
    const resp = await client.chat.completions.create({
      model: models.fast,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are Northbridge Brief planner. Output a short numbered investigation plan (max 6 steps).",
        },
        { role: "user", content: goal },
      ],
    });
    return {
      plan: resp.choices[0]?.message?.content || "Investigate anomalies.",
      meta: {
        mode: "live",
        model: models.fast,
        used_token_factory: true,
      },
    };
  } catch {
    return {
      plan: `Fallback plan for: ${goal}`,
      meta: {
        mode: "offline",
        model: models.fast + " (live-error-fallback)",
        used_token_factory: false,
      },
    };
  }
}
