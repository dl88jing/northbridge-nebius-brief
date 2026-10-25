import { runInvestigation } from "../lib/agent";
import { getStatus } from "../lib/status";
import { formatUsd } from "../lib/pricing";

async function main() {
  const before = getStatus();
  console.log(`Northbridge Brief demo  (mode: ${before.mode.toUpperCase()})\n`);
  if (before.mode !== "live") {
    console.log("NOTE: running without " + [!before.token_factory && "NEBIUS_API_KEY", !before.tavily && "TAVILY_API_KEY"].filter(Boolean).join(" + ") + ".");
    console.log("      Offline parts use templates/fixtures and are labeled as such. No costs are reported for them.\n");
  }
  console.log(`Models: fast=${before.models.fast}  reason=${before.models.reason}  ultra=${before.models.ultra}\n`);

  const r = await runInvestigation({ reset: true, goal: "Investigate all Northbridge anomalies quietly." });
  console.log("Summary:", r.summary, `in ${(r.duration_ms / 1000).toFixed(1)}s\n`);
  for (const x of r.results) {
    console.log(`[${x.decision === "AUTO" ? "AUTO " : "HUMAN"}] ${x.payee}`);
    for (const reason of x.reasons) console.log(`         - ${reason}`);
    if (x.brief) {
      console.log(`         brief (${x.brief.model_used}): ${x.brief.headline}`);
      console.log(`         action: ${x.brief.ultra_review?.final_recommendation || x.brief.recommended_action}`);
      for (const c of x.brief.citations || []) console.log(`         [${c.n}] ${c.url}`);
      if (x.brief.ultra_review) console.log(`         ultra review: ${x.brief.ultra_review.verdict}`);
    }
  }
  console.log("\nTrace:");
  for (const s of r.timeline) {
    const u = s.usage ? `  ${s.usage.prompt_tokens}->${s.usage.completion_tokens} tok ${formatUsd(s.usage.cost_usd)}` : "";
    console.log(`  - ${s.kind.padEnd(8)} ${s.title}${s.model ? `  <${s.model}>` : ""}${u}`);
  }
  const rc = r.receipt;
  if (rc?.measured) {
    console.log(`\nMeasured cost: ${formatUsd(rc.routed_cost_usd)} routed vs ${formatUsd(rc.all_ultra_repriced_usd)} if the same tokens ran on Ultra (${rc.savings_pct}% less). Tavily credits: ${rc.tavily_credits}.`);
  } else {
    console.log("\nNo measured token usage (offline). Set NEBIUS_API_KEY for a real cost receipt.");
  }
  console.log("\nDashboard: ./demo.sh dev   Tests: npm test");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
