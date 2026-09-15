import { loadBills, loadPolicy, getFunding } from "./fixtures";
import type { Bill, Decision } from "./types";

export type PolicyVerdict = {
  decision: Decision;
  reasons: string[];
  rule_ids: string[];
  needs_research: boolean;
  funding_ok: boolean;
  available_after_reserve: number;
};

export function evaluateBill(bill: Bill): PolicyVerdict {
  const policy = loadPolicy();
  const bills = loadBills();
  const fund = getFunding(bill.funding_account_id);
  const reasons: string[] = [];
  const rule_ids: string[] = [];
  let needs_research = false;

  const [lo, hi] = bill.expected_amount_range;
  if (bill.amount < lo || bill.amount > hi) {
    reasons.push(
      `Amount $${bill.amount.toFixed(2)} outside expected $${lo.toFixed(2)}–$${hi.toFixed(2)}`
    );
    rule_ids.push("amount_out_of_band");
    needs_research = true;
  }

  const dup = bills.find(
    (other) =>
      other.id !== bill.id &&
      other.payee === bill.payee &&
      other.amount === bill.amount &&
      other.due_date === bill.due_date &&
      other.status === "due"
  );
  if (dup) {
    reasons.push(`Possible duplicate of ${dup.id} (${dup.payee})`);
    rule_ids.push("duplicate_charge");
    needs_research = true;
  }

  const sensitive = ["medical", "tax", "legal", "unknown"];
  if (sensitive.includes(bill.category)) {
    reasons.push(`Sensitive category: ${bill.category}`);
    rule_ids.push("category_sensitive");
    needs_research = true;
  }

  const available_after_reserve = fund
    ? fund.available_balance - fund.reserve_floor
    : 0;
  let funding_ok = true;
  if (!fund || available_after_reserve < bill.amount) {
    funding_ok = false;
    reasons.push(
      fund
        ? `Funding shortfall: $${available_after_reserve.toFixed(2)} available after reserve vs $${bill.amount.toFixed(2)}`
        : "Funding account missing"
    );
    rule_ids.push("insufficient_funding");
  }

  if (reasons.length > 0) {
    return {
      decision: "HUMAN_REQUIRED",
      reasons,
      rule_ids,
      needs_research,
      funding_ok,
      available_after_reserve,
    };
  }

  if (!policy.auto_eligible_categories.includes(bill.category)) {
    return {
      decision: "HUMAN_REQUIRED",
      reasons: [`Category ${bill.category} is not auto-eligible`],
      rule_ids: ["category_sensitive"],
      needs_research: false,
      funding_ok,
      available_after_reserve,
    };
  }

  return {
    decision: "AUTO",
    reasons: ["Routine bill within expected band with adequate funding"],
    rule_ids: ["routine_in_band"],
    needs_research: false,
    funding_ok,
    available_after_reserve,
  };
}
