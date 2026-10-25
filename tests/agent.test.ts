import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { clearKeys } from "./helpers";
import { runInvestigation } from "../lib/agent";
import { setChatClient, type ChatClient } from "../lib/llm";
import { setFetcher } from "../lib/tavily";
import { getStatus } from "../lib/status";

beforeEach(() => clearKeys());
afterEach(() => {
  setChatClient(null);
  setFetcher(null);
  clearKeys();
});

test("offline run is honest: labeled fixtures, no tokens, no cost", async () => {
  let netCalls = 0;
  setFetcher((async () => { netCalls++; throw new Error("network should not be used offline"); }) as typeof fetch);
  const r = await runInvestigation({ persist: false });
  assert.equal(r.mode, "offline");
  assert.equal(r.summary.auto, 2);
  assert.equal(r.summary.escalated, 4);
  assert.equal(r.receipt?.measured, false);
  assert.equal(netCalls, 0);
  const research = r.timeline.filter((s) => s.kind === "research");
  assert.ok(research.length > 0);
  for (const s of research) assert.match(s.title, /OFFLINE/);
  for (const res of r.results.filter((x) => x.brief)) {
    assert.equal(res.brief!.mode, "offline");
    assert.ok(res.brief!.citations && res.brief!.citations.length > 0, "every brief cites sources");
    assert.equal(res.brief!.ultra_review, undefined);
  }
  // AUTO bills spend zero LLM calls
  const autoSteps = r.results.filter((x) => x.action === "auto_handled").flatMap((x) => x.steps);
  assert.ok(autoSteps.every((s) => !s.usage));
});

test("live path: Nano plans, Super writes cited briefs, Ultra reviews the high-stakes one", async () => {
  process.env.NEBIUS_API_KEY = "test-not-a-real-key";
  process.env.TAVILY_API_KEY = "test-not-a-real-key";
  const seen: string[] = [];
  const fake: ChatClient = {
    chat: {
      completions: {
        create: async ({ model }) => {
          seen.push(model);
          let content = "Plan: check rules, research anomalies, brief humans.";
          if (/super/i.test(model)) content = JSON.stringify({
            headline: "Plan bump needs a decision",
            situation: "The charge is above the expected band [1].",
            why_it_matters: "Recurring overcharge [2].",
            recommended_action: "Confirm or downgrade the plan.",
            questions_for_humans: ["Keep premium?"],
            research_summary: "Sources describe the price change [1][2].",
            speakable: "One bill needs you.",
          });
          if (/ultra/i.test(model)) content = JSON.stringify({ verdict: "confirm", unsupported_claims: [], final_recommendation: "Call the office before paying.", reason: "Claims match sources." });
          return { choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } };
        },
      },
    },
  };
  setChatClient(fake);
  const urls: string[] = [];
  setFetcher((async (url: string | URL | Request) => {
    const u = String(url);
    urls.push(u);
    const body = u.endsWith("/search")
      ? { results: [{ title: "Source A", url: "https://a.example.org/x", content: "alpha", score: 0.9 }, { title: "Source B", url: "https://b.example.org/y", content: "beta", score: 0.8 }], usage: { credits: 2 } }
      : { results: [{ url: "https://a.example.org/x", raw_content: "extracted passage" }], usage: { credits: 1 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch);

  const r = await runInvestigation({ persist: false });
  assert.equal(r.mode, "live");
  assert.ok(urls.some((u) => u.endsWith("/search")) && urls.some((u) => u.endsWith("/extract")));
  assert.ok(seen.some((m) => /nano/i.test(m)), "Nano used for planning");
  assert.ok(seen.some((m) => /super/i.test(m)), "Super used for briefs");
  assert.ok(seen.some((m) => /ultra/i.test(m)), "Ultra used for escalation review");
  const dental = r.results.find((x) => x.bill_id === "bill-dental-2026-09")!;
  assert.equal(dental.brief!.ultra_review?.verdict, "confirm");
  assert.equal(dental.brief!.citations?.[0].url, "https://a.example.org/x");
  assert.equal(r.receipt?.measured, true);
  assert.ok(r.receipt!.routed_cost_usd < r.receipt!.all_ultra_repriced_usd);
  assert.equal(r.receipt!.tavily_credits, 3 * r.results.filter((x) => x.research).length);
  const research = r.timeline.find((s) => s.kind === "research")!;
  assert.match(research.title, /Tavily search \+ extract/);
});

test("status never leaks key values", () => {
  process.env.NEBIUS_API_KEY = "sk-SHOULD-NOT-APPEAR";
  process.env.TAVILY_API_KEY = "tvly-SHOULD-NOT-APPEAR";
  const s = JSON.stringify(getStatus());
  assert.ok(!s.includes("SHOULD-NOT-APPEAR"));
  assert.match(s, /"token_factory":true/);
});

test("provider failure never surfaces an error: labeled fallbacks, run_mode=degraded", async () => {
  process.env.NEBIUS_API_KEY = "test-not-a-real-key";
  process.env.TAVILY_API_KEY = "test-not-a-real-key";
  const { clearResearchCache } = await import("../lib/tavily");
  clearResearchCache();
  setChatClient({ chat: { completions: { create: async () => { throw new Error("402 insufficient balance"); } } } } as ChatClient);
  setFetcher((async () => new Response("{}", { status: 432 })) as typeof fetch);
  const r = await runInvestigation({ persist: false, budget_ms: 20_000 });
  assert.equal(r.ok, true);
  assert.equal(r.run_mode, "degraded");
  assert.ok(r.fallbacks.length > 0);
  assert.equal(r.summary.escalated, 4);
  for (const res of r.results.filter((x) => x.brief)) {
    assert.equal(res.brief!.mode, "fallback");
    assert.ok(res.brief!.citations && res.brief!.citations.length > 0);
  }
  assert.ok(r.timeline.some((s) => /FALLBACK/.test(s.title)));
  assert.ok(r.fallbacks.some((f) => /credit limit/.test(f)), "Tavily credit exhaustion is named");
});

test("offline flag forces the labeled offline path even with keys set (no network)", async () => {
  process.env.NEBIUS_API_KEY = "test-not-a-real-key";
  process.env.TAVILY_API_KEY = "test-not-a-real-key";
  let calls = 0;
  setChatClient({ chat: { completions: { create: async () => { calls++; throw new Error("no"); } } } } as ChatClient);
  setFetcher((async () => { calls++; throw new Error("no"); }) as typeof fetch);
  const r = await runInvestigation({ persist: false, offline: true });
  assert.equal(r.mode, "offline");
  assert.equal(r.run_mode, "offline");
  assert.equal(calls, 0);
});
