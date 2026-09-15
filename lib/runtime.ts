import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import type { InvestigateResponse, RuntimeState } from "./types";

const DIR = path.join(process.cwd(), "data", "runtime");
const FILE = path.join(DIR, "state.json");

function empty(): RuntimeState {
  return { handled: [], needs_decision: [], briefs: {} };
}

export function loadRuntime(): RuntimeState {
  try {
    if (!existsSync(FILE)) return empty();
    return JSON.parse(readFileSync(FILE, "utf8")) as RuntimeState;
  } catch {
    return empty();
  }
}

export function saveRuntime(state: RuntimeState) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function resetRuntime() {
  saveRuntime(empty());
}

export function persistInvestigation(res: InvestigateResponse) {
  const state = loadRuntime();
  for (const r of res.results) {
    if (r.action === "auto_handled") {
      if (!state.handled.includes(r.bill_id)) state.handled.push(r.bill_id);
      state.needs_decision = state.needs_decision.filter((id) => id !== r.bill_id);
    } else {
      if (!state.needs_decision.includes(r.bill_id)) {
        state.needs_decision.push(r.bill_id);
      }
      if (r.brief) state.briefs[r.bill_id] = r.brief;
    }
  }
  state.last_run = res;
  saveRuntime(state);
  return state;
}
