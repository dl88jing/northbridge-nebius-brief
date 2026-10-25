import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBills } from "../lib/fixtures";
import { evaluateBill } from "../lib/policy";

const decisions = Object.fromEntries(loadBills().map((b) => [b.id, evaluateBill(b)]));

test("routine bills are auto-handled", () => {
  assert.equal(decisions["bill-rent-2026-09"].decision, "AUTO");
  assert.equal(decisions["bill-fiber-2026-09"].decision, "AUTO");
});

test("anomalies escalate to a human with the right rule", () => {
  assert.equal(decisions["bill-streamflix-2026-09"].decision, "HUMAN_REQUIRED");
  assert.ok(decisions["bill-streamflix-2026-09"].rule_ids.includes("amount_out_of_band"));
  for (const id of ["bill-pge-2026-09", "bill-pge-dup-2026-09"]) {
    assert.equal(decisions[id].decision, "HUMAN_REQUIRED");
    assert.ok(decisions[id].rule_ids.includes("duplicate_charge"));
  }
  assert.ok(decisions["bill-dental-2026-09"].rule_ids.includes("category_sensitive"));
});
