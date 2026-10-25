import { costUsd, PRICES_AS_OF, PRICE_SOURCE } from "./pricing";
import type { CostReceipt, LlmUsage } from "./types";

/** Build a cost receipt from measured Token Factory usage only. */
export function buildReceipt(usages: LlmUsage[], tavilyCredits: number, ultraModel: string): CostReceipt {
  const measured = usages.filter((u) => u.measured);
  const per = new Map<string, { model: string; calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number }>();
  let pt = 0;
  let ct = 0;
  let routed = 0;
  let ultra = 0;
  for (const u of measured) {
    pt += u.prompt_tokens;
    ct += u.completion_tokens;
    routed += u.cost_usd ?? 0;
    ultra += costUsd(ultraModel, u.prompt_tokens, u.completion_tokens) ?? 0;
    const row = per.get(u.model) || { model: u.model, calls: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0 };
    row.calls++;
    row.prompt_tokens += u.prompt_tokens;
    row.completion_tokens += u.completion_tokens;
    row.cost_usd += u.cost_usd ?? 0;
    per.set(u.model, row);
  }
  return {
    measured: measured.length > 0,
    calls: measured.length,
    prompt_tokens: pt,
    completion_tokens: ct,
    routed_cost_usd: routed,
    all_ultra_repriced_usd: ultra,
    savings_pct: ultra > 0 ? Math.round((1 - routed / ultra) * 1000) / 10 : 0,
    tavily_credits: tavilyCredits,
    per_model: [...per.values()],
    prices_as_of: PRICES_AS_OF,
    price_source: PRICE_SOURCE,
  };
}
