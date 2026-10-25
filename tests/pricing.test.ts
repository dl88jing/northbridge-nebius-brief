import { test } from "node:test";
import assert from "node:assert/strict";
import { costUsd, priceFor } from "../lib/pricing";
import { buildReceipt } from "../lib/receipt";
import type { LlmUsage } from "../lib/types";

const NANO = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B";
const SUPER = "nvidia/nemotron-3-super-120b-a12b";
const ULTRA = "nvidia/Nemotron-3-Ultra-550b-a55b";

test("prices are per 1M tokens and case-insensitive", () => {
  assert.ok(priceFor(NANO.toLowerCase()));
  assert.equal(costUsd(NANO, 1_000_000, 0), 0.06);
  assert.equal(costUsd(SUPER, 0, 1_000_000), 0.9);
  assert.equal(costUsd(ULTRA, 1_000_000, 1_000_000), 4);
  assert.equal(costUsd("unknown/model", 10, 10), undefined);
});

test("receipt only counts measured usage and reprices the same tokens at Ultra", () => {
  const u = (model: string, p: number, c: number, measured = true): LlmUsage => ({
    model, prompt_tokens: p, completion_tokens: c, latency_ms: 1, cost_usd: costUsd(model, p, c), measured,
  });
  const r = buildReceipt([u(NANO, 1000, 200), u(SUPER, 2000, 500), u(ULTRA, 1, 1, false)], 4, ULTRA);
  assert.equal(r.measured, true);
  assert.equal(r.calls, 2);
  assert.equal(r.prompt_tokens, 3000);
  assert.equal(r.completion_tokens, 700);
  const routed = costUsd(NANO, 1000, 200)! + costUsd(SUPER, 2000, 500)!;
  const ultra = costUsd(ULTRA, 3000, 700)!;
  assert.ok(Math.abs(r.routed_cost_usd - routed) < 1e-9);
  assert.ok(Math.abs(r.all_ultra_repriced_usd - ultra) < 1e-9);
  assert.ok(r.savings_pct > 50 && r.savings_pct < 100);
  assert.equal(r.tavily_credits, 4);
});

test("empty receipt is explicitly unmeasured", () => {
  const r = buildReceipt([], 0, ULTRA);
  assert.equal(r.measured, false);
  assert.equal(r.routed_cost_usd, 0);
});
