import { getTavilyKey, hasTavilyKey } from "./config";
import { loadOfflineResearch } from "./fixtures";
import type { ResearchBundle } from "./types";

function bestOfflineMatch(query: string): ResearchBundle {
  const store = loadOfflineResearch();
  const keys = Object.keys(store);
  const q = query.toLowerCase();
  const hit =
    keys.find((k) => q.includes(k.toLowerCase().slice(0, 18))) ||
    keys.find((k) =>
      k
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .some((w) => q.includes(w))
    );
  if (hit) {
    return { ...store[hit], source: "offline_fixture" };
  }
  return {
    query,
    source: "offline_fixture",
    results: [
      {
        title: "No offline fixture match",
        url: "https://example.com/northbridge/research",
        snippet:
          "Offline demo has no exact research fixture for this query. Add TAVILY_API_KEY for live web research.",
      },
    ],
  };
}

export async function researchWeb(query: string): Promise<ResearchBundle> {
  if (!hasTavilyKey()) {
    return bestOfflineMatch(query);
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: getTavilyKey(),
        query,
        search_depth: "basic",
        max_results: 4,
        include_answer: false,
      }),
    });
    if (!res.ok) {
      return bestOfflineMatch(query);
    }
    const data = (await res.json()) as {
      results?: { title: string; url: string; content: string }[];
    };
    return {
      query,
      source: "tavily",
      results: (data.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 280) || "",
      })),
    };
  } catch {
    return bestOfflineMatch(query);
  }
}

export function researchQueryForBill(payee: string, kind: string): string {
  if (kind.includes("duplicate")) {
    return `${payee} duplicate bill September 2026`;
  }
  if (payee.toLowerCase().includes("streamflix")) {
    return "StreamFlix Premium price increase 2026";
  }
  if (payee.toLowerCase().includes("dental")) {
    return "Bayview Family Dental crown insurance remittance";
  }
  if (payee.toLowerCase().includes("dmv") || kind.includes("admin")) {
    return "Cascadia vehicle registration renewal 2026";
  }
  return `${payee} billing anomaly 2026`;
}
