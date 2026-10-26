/**
 * Policy-gate decision table on the fixture household plus synthetic edge cases.
 * The gate is pure TypeScript (no LLM, no network): these tests pin down exactly
 * which bills are paid silently and which ones reach Avery & Morgan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBills, loadPolicy, getFunding } from "../lib/fixtures";
import { evaluateBill } from "../lib/policy";
import type { Bill } from "../lib/types";
import { clearKeys } from "./helpers";

clearKeys();

const rent = loadBills().find((b) => b.id === "bill-rent-2026-09")!;
const checking = getFunding("fund-checking")!;
const headroom = checking.available_balance - checking.reserve_floor;

function bill(overrides: Partial<Bill>): Bill {
  return { ...rent, id: "synthetic", payee: "Synthetic Payee", ...overrides };
}

test("golden decision table for every fixture bill", () => {
  const expected: Record<string, { decision: string; rules: string[]; research: boolean }> = {
    "bill-pge-2026-09": { decision: "HUMAN_REQUIRED", rules: ["duplicate_charge"], research: true },
    "bill-pge-dup-2026-09": { decision: "HUMAN_REQUIRED", rules: ["duplicate_charge"], research: true },
    "bill-streamflix-2026-09": { decision: "HUMAN_REQUIRED", rules: ["amount_out_of_band"], research: true },
    "bill-rent-2026-09": { decision: "AUTO", rules: ["routine_in_band"], research: false },
    "bill-dental-2026-09": {
      decision: "HUMAN_REQUIRED",
      rules: ["amount_out_of_band", "category_sensitive"],
      research: true,
    },
    "bill-fiber-2026-09": { decision: "AUTO", rules: ["routine_in_band"], research: false },
  };
  const bills = loadBills();
  assert.deepEqual(bills.map((b) => b.id).sort(), Object.keys(expected).sort());
  for (const b of bills) {
    const v = evaluateBill(b);
    const e = expected[b.id];
    assert.equal(v.decision, e.decision, b.id);
    assert.deepEqual(v.rule_ids, e.rules, b.id);
    assert.equal(v.needs_research, e.research, b.id);
  }
});

test("exactly 2 of 6 fixture bills are handled silently", () => {
  const auto = loadBills().filter((b) => evaluateBill(b).decision === "AUTO");
  assert.equal(auto.length, 2);
});

test("every escalation carries at least one human-readable reason and rule id", () => {
  for (const b of loadBills()) {
    const v = evaluateBill(b);
    assert.ok(v.reasons.length >= 1 && v.rule_ids.length >= 1, b.id);
    if (v.decision === "HUMAN_REQUIRED") assert.ok(!v.rule_ids.includes("routine_in_band"), b.id);
  }
});

test("amounts exactly on the expected-band edges stay AUTO", () => {
  const lo = evaluateBill(bill({ category: "utilities", amount: 100, expected_amount_range: [100, 200] }));
  const hi = evaluateBill(bill({ category: "utilities", amount: 200, expected_amount_range: [100, 200] }));
  assert.equal(lo.decision, "AUTO");
  assert.equal(hi.decision, "AUTO");
});

test("one cent outside the band escalates with research", () => {
  const v = evaluateBill(bill({ category: "utilities", amount: 200.01, expected_amount_range: [100, 200] }));
  assert.equal(v.decision, "HUMAN_REQUIRED");
  assert.deepEqual(v.rule_ids, ["amount_out_of_band"]);
  assert.equal(v.needs_research, true);
});

test("funding shortfall below the reserve floor escalates without web research", () => {
  const amount = Math.ceil(headroom) + 1;
  const v = evaluateBill(bill({ amount, expected_amount_range: [amount, amount] }));
  assert.equal(v.decision, "HUMAN_REQUIRED");
  assert.deepEqual(v.rule_ids, ["insufficient_funding"]);
  assert.equal(v.funding_ok, false);
  assert.equal(v.needs_research, false);
  assert.ok(Math.abs(v.available_after_reserve - headroom) < 1e-9);
});

test("a bill that fits exactly in the headroom is still payable", () => {
  const amount = Math.floor(headroom * 100) / 100;
  const v = evaluateBill(bill({ amount, expected_amount_range: [amount, amount] }));
  assert.equal(v.decision, "AUTO");
  assert.equal(v.funding_ok, true);
});

test("an unknown funding account is never auto-paid", () => {
  const v = evaluateBill(bill({ funding_account_id: "fund-does-not-exist" }));
  assert.equal(v.decision, "HUMAN_REQUIRED");
  assert.ok(v.rule_ids.includes("insufficient_funding"));
  assert.ok(v.reasons.includes("Funding account missing"));
});

test("sensitive categories always escalate and trigger research", () => {
  for (const category of ["medical", "tax", "legal", "unknown"]) {
    const v = evaluateBill(bill({ category, amount: 50, expected_amount_range: [40, 60] }));
    assert.equal(v.decision, "HUMAN_REQUIRED", category);
    assert.ok(v.rule_ids.includes("category_sensitive"), category);
    assert.equal(v.needs_research, true, category);
  }
});

test("non-sensitive but non-allow-listed categories escalate without research", () => {
  const allow = loadPolicy().auto_eligible_categories;
  assert.ok(!allow.includes("gym"));
  const v = evaluateBill(bill({ category: "gym", amount: 50, expected_amount_range: [40, 60] }));
  assert.equal(v.decision, "HUMAN_REQUIRED");
  assert.deepEqual(v.rule_ids, ["category_sensitive"]);
  assert.equal(v.needs_research, false);
});

test("every allow-listed category is AUTO when in band and funded", () => {
  for (const category of loadPolicy().auto_eligible_categories) {
    const v = evaluateBill(bill({ category, amount: 50, expected_amount_range: [40, 60] }));
    assert.equal(v.decision, "AUTO", category);
  }
});

test("the gate is deterministic (same input, same verdict)", () => {
  for (const b of loadBills()) assert.deepEqual(evaluateBill(b), evaluateBill(b));
});
