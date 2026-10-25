import { getTavilyKey, hasTavilyKey } from "./config";
import { loadOfflineResearch } from "./fixtures";
import type { Bill, ResearchBundle } from "./types";

const TAVILY = "https://api.tavily.com";

export type ResearchPlan = {
  /** Real-world question sent to Tavily (household names are pseudonyms, so we search the underlying issue). */
  query: string;
  /** Key into data/offline_research.json for the labeled offline fallback. */
  fixtureKey: string;
};

/**
 * Turn a policy hit into a web question whose answer changes the recommendation.
 * Pseudonymous payees (StreamFlix, Bayview Dental) are not searched by name: we search the real issue.
 */
export function researchPlanForBill(bill: Bill, ruleIds: string[]): ResearchPlan {
  const payee = bill.payee.toLowerCase();
  if (ruleIds.includes("duplicate_charge")) {
    return {
      query: `${bill.payee} duplicate bill same billing period paper and e-bill how to avoid paying twice`,
      fixtureKey: "Pacific Gas & Electric duplicate bill September 2026",
    };
  }
  if (bill.category === "medical" || payee.includes("dental")) {
    return {
      query: "dental crown bill before insurance explanation of benefits should I pay the estimate or wait for EOB",
      fixtureKey: "Bayview Family Dental crown insurance remittance",
    };
  }
  if (ruleIds.includes("amount_out_of_band") && bill.category === "subscription") {
    return {
      query: "streaming subscription price increase 2026 autopay notice how to downgrade or dispute the new price",
      fixtureKey: "StreamFlix Premium price increase 2026",
    };
  }
  if (payee.includes("dmv") || bill.category === "admin") {
    return { query: "vehicle registration renewal late fee grace period", fixtureKey: "Cascadia vehicle registration renewal 2026" };
  }
  return { query: `${bill.category} bill higher than usual what to check before paying`, fixtureKey: "" };
}

export function offlineResearch(plan: ResearchPlan): ResearchBundle {
  const store = loadOfflineResearch();
  const hit = plan.fixtureKey ? store[plan.fixtureKey] : undefined;
  if (hit) return { ...hit, query: plan.query, source: "offline_fixture" };
  return {
    query: plan.query,
    source: "offline_fixture",
    results: [
      {
        title: "No offline fixture for this query",
        url: "https://example.com/northbridge/offline",
        snippet: "Offline demo. Set TAVILY_API_KEY for live web research.",
      },
    ],
  };
}

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...a) => fetch(...a);
/** Test hook. */
export function setFetcher(f: Fetcher | null) {
  fetcher = f ?? ((...a) => fetch(...a));
}

async function post<T>(path: string, body: unknown, timeoutMs = 12_000): Promise<T> {
  const res = await fetcher(`${TAVILY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getTavilyKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const why = res.status === 432 || res.status === 433 ? " (plan credit limit reached)" : res.status === 429 ? " (rate limited)" : "";
    throw new Error(`Tavily ${path} HTTP ${res.status}${why}`);
  }
  return (await res.json()) as T;
}

/**
 * Live research = Tavily /search (advanced) + /extract on the top sources,
 * with the extract reranked against our question so the brief can quote real passages.
 */
/** Same question within 6 h on the same instance → reuse the live result (0 new credits). Keeps free-plan credit use modest. */
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; bundle: ResearchBundle }>();
const inflight = new Map<string, Promise<ResearchBundle>>();
export function clearResearchCache() {
  cache.clear();
}

/** Drop duplicate sources (same page under two URLs, e.g. with and without a locale path). */
function dedupeResults<T extends { title: string; url: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    let host = r.url;
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {}
    const k = `${host}|${r.title.trim().toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function researchWeb(plan: ResearchPlan): Promise<ResearchBundle> {
  if (!hasTavilyKey()) return offlineResearch(plan);
  const hit = cache.get(plan.query);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.bundle, credits: 0, cached: true };
  // Two bills with the same question in one run (e.g. both PG&E statements) share one in-flight search.
  const pending = inflight.get(plan.query);
  if (pending) return { ...(await pending), credits: 0, cached: true };
  const p = researchLive(plan);
  inflight.set(plan.query, p);
  try {
    const out = await p;
    if (out.source === "tavily" && !out.error) cache.set(plan.query, { at: Date.now(), bundle: out });
    return out;
  } finally {
    inflight.delete(plan.query);
  }
}

async function researchLive(plan: ResearchPlan): Promise<ResearchBundle> {
  const bundle: ResearchBundle = { query: plan.query, source: "tavily", results: [], credits: 0 };
  try {
    const t0 = Date.now();
    const s = await post<{
      results?: { title: string; url: string; content: string; score?: number }[];
      usage?: { credits?: number };
    }>("/search", {
      query: plan.query,
      search_depth: "advanced",
      max_results: 5,
      include_answer: false,
      include_usage: true,
    });
    bundle.search_ms = Date.now() - t0;
    bundle.credits = (bundle.credits ?? 0) + (s.usage?.credits ?? 0);
    bundle.results = dedupeResults(s.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: (r.content || "").slice(0, 320),
      score: r.score,
    }));
  } catch (e) {
    const fb = offlineResearch(plan);
    return { ...fb, fallback: true, error: e instanceof Error ? e.message : "Tavily search failed" };
  }

  const top = bundle.results.slice(0, 3).map((r) => r.url);
  if (top.length) {
    try {
      const t1 = Date.now();
      const x = await post<{ results?: { url: string; raw_content?: string }[]; usage?: { credits?: number } }>("/extract", {
        urls: top,
        query: plan.query,
        chunks_per_source: 2,
        extract_depth: "basic",
        format: "text",
        include_usage: true,
      }, 10_000);
      bundle.extract_ms = Date.now() - t1;
      bundle.credits = (bundle.credits ?? 0) + (x.usage?.credits ?? 0);
      let n = 0;
      for (const r of x.results || []) {
        const hit = bundle.results.find((h) => h.url === r.url);
        if (hit && r.raw_content) {
          hit.extract = r.raw_content.replace(/\s+/g, " ").slice(0, 900);
          n++;
        }
      }
      bundle.extracted_count = n;
    } catch (e) {
      // Search results are still real; the brief just uses snippets instead of extracts.
      bundle.extract_error = e instanceof Error ? e.message : "Tavily extract failed";
    }
  }
  return bundle;
}
