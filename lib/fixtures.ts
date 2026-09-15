import { readFileSync } from "fs";
import path from "path";
import type { Bill, CalendarDue, FundingAccount, ResearchBundle } from "./types";

const DATA = path.join(process.cwd(), "data");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DATA, name), "utf8")) as T;
}

export function loadHousehold() {
  return loadJson<{
    id: string;
    name: string;
    members: { id: string; name: string; role: string }[];
    preferences: Record<string, unknown>;
  }>("household.json");
}

export function loadBills(): Bill[] {
  return loadJson<Bill[]>("bills.json");
}

export function loadFunding(): FundingAccount[] {
  return loadJson<FundingAccount[]>("funding_accounts.json");
}

export function loadDues(): CalendarDue[] {
  return loadJson<CalendarDue[]>("calendar_dues.json");
}

export function loadPolicy() {
  return loadJson<{
    version: string;
    mode: string;
    rules: { id: string; decision: string; reason: string; research?: boolean }[];
    auto_eligible_categories: string[];
    nemotron: { fast_model: string; reason_model: string; base_url: string };
  }>("policy.json");
}

export function loadOfflineResearch(): Record<string, ResearchBundle> {
  return loadJson<Record<string, ResearchBundle>>("offline_research.json");
}

export function getBill(id: string): Bill | undefined {
  return loadBills().find((b) => b.id === id);
}

export function getFunding(id: string): FundingAccount | undefined {
  return loadFunding().find((a) => a.id === id);
}
