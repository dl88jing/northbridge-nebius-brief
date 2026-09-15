import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import type { InvestigateResponse, RuntimeState } from "./types";

/** Prefer writable /tmp on Vercel; fall back to data/runtime locally. */
function statePaths(): string[] {
  const tmp = path.join("/tmp", "northbridge-brief-state.json");
  const localDir = path.join(process.cwd(), "data", "runtime");
  const local = path.join(localDir, "state.json");
  // On Vercel/serverless, cwd is read-only — use tmp first.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return [tmp, local];
  }
  return [local, tmp];
}

let memory: RuntimeState | null = null;

function empty(): RuntimeState {
  return { handled: [], needs_decision: [], briefs: {} };
}

export function loadRuntime(): RuntimeState {
  if (memory) return memory;
  for (const file of statePaths()) {
    try {
      if (existsSync(file)) {
        memory = JSON.parse(readFileSync(file, "utf8")) as RuntimeState;
        return memory;
      }
    } catch {
      /* try next */
    }
  }
  memory = empty();
  return memory;
}

export function saveRuntime(state: RuntimeState) {
  memory = state;
  for (const file of statePaths()) {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(state, null, 2));
      return;
    } catch {
      /* try next path / memory-only */
    }
  }
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
