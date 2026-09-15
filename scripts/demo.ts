import { runInvestigation } from "../lib/agent";
import { getStatus } from "../lib/status";

async function main() {
  console.log("Northbridge Brief — offline judge demo\n");
  const before = getStatus();
  console.log(`Mode: ${before.mode}`);
  console.log(`Token Factory key present: ${before.token_factory}`);
  console.log(`Tavily key present: ${before.tavily}`);
  console.log(`Fast model: ${before.models.fast}`);
  console.log(`Reason model: ${before.models.reason}\n`);

  const result = await runInvestigation({
    reset: true,
    goal: "Judge demo: investigate all Northbridge anomalies quietly.",
  });

  console.log("Summary:", result.summary);
  console.log("");
  for (const r of result.results) {
    const mark = r.decision === "AUTO" ? "AUTO " : "HUMAN";
    console.log(`[${mark}] ${r.payee}`);
    for (const reason of r.reasons) console.log(`         - ${reason}`);
    if (r.brief) {
      console.log(`         brief: ${r.brief.headline}`);
      console.log(`         action: ${r.brief.recommended_action}`);
      if (r.research?.results?.[0]) {
        console.log(`         research: ${r.research.results[0].title}`);
      }
    }
  }

  console.log("\nTimeline steps:", result.timeline.length);
  console.log("Expected escalations: StreamFlix, PG&E duplicate pair, Bayview Dental");
  console.log("Expected auto: Cascadia Fiber, Rent");
  console.log("\nDone. Start the dashboard with: ./demo.sh dev");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
