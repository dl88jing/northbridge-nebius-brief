#!/usr/bin/env node
// Repeated-run evaluation against a deployed Northbridge Brief.
// Usage: node scripts/eval-live.mjs [baseUrl] [runs]
// Defaults: https://northbridge-nebius-brief.vercel.app, 5 runs.
// Writes docs/live-eval.json (raw per-run metrics) and docs/live-eval.md (summary).
// Cost: about $0.005 of Token Factory usage and ~7-9 Tavily credits per run.
import { writeFileSync } from "node:fs";

const base = (process.argv[2] || "https://northbridge-nebius-brief.vercel.app").replace(/\/$/, "");
const runs = Number(process.argv[3] || 5);

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const BRIEF_TEXT_FIELDS = ["situation", "why_it_matters", "recommended_action", "research_summary"];

function briefMetrics(brief) {
  const text = BRIEF_TEXT_FIELDS.map((k) => brief[k] || "").join(" ");
  const markers = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const ns = new Set((brief.citations || []).map((c) => c.n));
  const resolved = markers.filter((n) => ns.has(n)).length;
  const urls = (brief.citations || []).map((c) => c.url || "");
  const realUrls = urls.filter((u) => /^https?:\/\//.test(u) && !/example\.com/.test(u)).length;
  return {
    bill_id: brief.bill_id,
    model: brief.model_used,
    mode: brief.mode,
    sources: urls.length,
    real_urls: realUrls,
    markers: markers.length,
    markers_resolved: resolved,
    distinct_cited: new Set(markers.filter((n) => ns.has(n))).size,
  };
}

async function one(i) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/investigate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reset: true }),
  });
  const wall_ms = Date.now() - t0;
  const d = await res.json();
  const r = d.receipt || {};
  const briefs = (d.results || []).filter((x) => x.brief).map((x) => briefMetrics(x.brief));
  const steps = (d.timeline || []).filter((s) => s.usage && s.usage.measured);
  return {
    run: i + 1,
    http: res.status,
    started_at: d.started_at,
    run_mode: d.run_mode,
    fallbacks: (d.fallbacks || []).length,
    server_ms: d.duration_ms,
    wall_ms,
    decisions: (d.results || []).map((x) => `${x.bill_id}:${x.decision}`).join(","),
    auto: d.summary?.auto,
    escalated: d.summary?.escalated,
    llm_calls: r.calls,
    prompt_tokens: r.prompt_tokens,
    completion_tokens: r.completion_tokens,
    routed_cost_usd: r.routed_cost_usd,
    all_ultra_repriced_usd: r.all_ultra_repriced_usd,
    savings_pct: r.savings_pct,
    tavily_credits: r.tavily_credits,
    step_latency_ms: steps.map((s) => ({ model: s.usage.model, ms: s.usage.latency_ms })),
    briefs,
  };
}

const out = [];
for (let i = 0; i < runs; i++) {
  try {
    const r = await one(i);
    out.push(r);
    console.log(`run ${i + 1}/${runs}: ${r.run_mode} in ${r.server_ms} ms, $${r.routed_cost_usd}, fallbacks ${r.fallbacks}`);
  } catch (e) {
    out.push({ run: i + 1, error: String(e) });
    console.log(`run ${i + 1}/${runs}: ERROR ${e}`);
  }
}

const ok = out.filter((r) => !r.error && r.http === 200);
const allBriefs = ok.flatMap((r) => r.briefs);
const decisionSets = new Set(ok.map((r) => r.decisions));
const byModel = {};
for (const r of ok) for (const s of r.step_latency_ms) (byModel[s.model] ||= []).push(s.ms);
const markers = allBriefs.reduce((s, b) => s + b.markers, 0);
const resolved = allBriefs.reduce((s, b) => s + b.markers_resolved, 0);
const summary = {
  base,
  runs_requested: runs,
  runs_ok: ok.length,
  live_runs: ok.filter((r) => r.run_mode === "live").length,
  runs_with_fallback: ok.filter((r) => r.fallbacks > 0).length,
  identical_decisions_across_runs: decisionSets.size === 1,
  server_ms: { mean: Math.round(mean(ok.map((r) => r.server_ms))), p50: pct(ok.map((r) => r.server_ms), 50), max: Math.max(...ok.map((r) => r.server_ms)) },
  routed_cost_usd_mean: mean(ok.map((r) => r.routed_cost_usd)),
  all_ultra_repriced_usd_mean: mean(ok.map((r) => r.all_ultra_repriced_usd)),
  savings_pct_mean: mean(ok.map((r) => r.savings_pct)),
  tokens_mean: Math.round(mean(ok.map((r) => r.prompt_tokens + r.completion_tokens))),
  tavily_credits_mean: mean(ok.map((r) => r.tavily_credits)),
  briefs: allBriefs.length,
  briefs_with_sources: allBriefs.filter((b) => b.sources > 0).length,
  briefs_with_real_urls_only: allBriefs.filter((b) => b.sources > 0 && b.real_urls === b.sources).length,
  briefs_with_inline_citation: allBriefs.filter((b) => b.markers_resolved > 0).length,
  citation_markers: markers,
  citation_markers_resolved: resolved,
  step_latency_ms_by_model: Object.fromEntries(Object.entries(byModel).map(([m, a]) => [m, { n: a.length, mean: Math.round(mean(a)), p50: pct(a, 50), max: Math.max(...a) }])),
};

writeFileSync("docs/live-eval.json", JSON.stringify({ summary, runs: out }, null, 2) + "\n");

const f = (x, d = 4) => (typeof x === "number" ? x.toFixed(d) : String(x));
const md = `# Live evaluation: ${summary.runs_ok} repeated runs

Generated by \`node scripts/eval-live.mjs\` against ${base}. Run window (UTC): ${ok[0]?.started_at ?? "n/a"} to ${ok.at(-1)?.started_at ?? "n/a"}. Raw per-run data: [live-eval.json](live-eval.json).

Each run is a full \`POST /api/investigate {"reset": true}\` on the deployed app: 6 fixture bills, the deterministic policy gate, Nemotron 3 Nano planning, Tavily search + extract, Nemotron 3 Super briefs, and a Nemotron 3 Ultra review of the dental bill.

| Metric | Value |
|---|---|
| Runs OK / requested | ${summary.runs_ok} / ${summary.runs_requested} |
| Runs fully live (no fallback) | ${ok.filter((r) => r.run_mode === "live" && r.fallbacks === 0).length} / ${summary.runs_ok} |
| Same policy decisions on every run | ${summary.identical_decisions_across_runs ? "yes" : "no"} |
| Server time per run (mean / p50 / max) | ${(summary.server_ms.mean / 1000).toFixed(1)} s / ${(summary.server_ms.p50 / 1000).toFixed(1)} s / ${(summary.server_ms.max / 1000).toFixed(1)} s |
| Measured Token Factory cost per run (mean) | $${f(summary.routed_cost_usd_mean, 5)} |
| Same tokens repriced at Ultra list price (mean) | $${f(summary.all_ultra_repriced_usd_mean, 5)} (${summary.savings_pct_mean.toFixed(1)}% saving; repricing, not a second run) |
| Tokens per run (mean) | ${summary.tokens_mean.toLocaleString("en-US")} |
| Tavily credits per run (mean) | ${summary.tavily_credits_mean.toFixed(1)} |
| Briefs generated | ${summary.briefs} |
| Briefs with sources | ${summary.briefs_with_sources} / ${summary.briefs} |
| Briefs whose sources are all real http(s) URLs (no fixtures) | ${summary.briefs_with_real_urls_only} / ${summary.briefs} |
| Briefs with at least one inline [n] citation | ${summary.briefs_with_inline_citation} / ${summary.briefs} |
| Inline [n] markers that resolve to a listed source | ${summary.citation_markers_resolved} / ${summary.citation_markers} |

## Per-step latency by model (measured, ms)

| Model | Calls | Mean | p50 | Max |
|---|---|---|---|---|
${Object.entries(summary.step_latency_ms_by_model).map(([m, s]) => `| \`${m}\` | ${s.n} | ${s.mean} | ${s.p50} | ${s.max} |`).join("\n")}

## How to read this

- Costs are the API-reported token counts times Token Factory list prices in \`lib/pricing.ts\` (read 2026-10-25), not an invoice.
- Tavily results are cached per server instance for 6 hours, so later runs on a warm instance may reuse sources and spend fewer credits.${summary.tavily_credits_mean === 0 ? " In this sample every run reused cached Tavily sources (0 credits), so the server times above exclude fresh web research; a cold run with fresh web research takes longer and spends Tavily credits." : ""}
- The citation checks are mechanical: every \`[n]\` must point at a source in the brief, and sources must be real URLs. They do not prove a source is the best one or that the model read it correctly; a human still reviews each brief, which is the point of the product.
- Small sample (${summary.runs_ok} runs, one household). It shows stability and cost on the deployed app, not general accuracy.
`;
writeFileSync("docs/live-eval.md", md);
console.log(JSON.stringify(summary, null, 2));
