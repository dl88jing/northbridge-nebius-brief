import { NextRequest, NextResponse } from "next/server";
import { hasNebiusKey, hasTavilyKey, runtimeMode, getModels, getTavilyKey } from "@/lib/config";
import { chat } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** GET /api/health            -> key presence + mode (no secrets)
 *  GET /api/health?probe=1    -> also makes one tiny real Token Factory call and one Tavily search */
export async function GET(req: NextRequest) {
  const models = getModels();
  const body: Record<string, unknown> = {
    ok: true,
    product: "Northbridge Brief",
    version: "1.1.0",
    mode: runtimeMode(),
    token_factory: hasNebiusKey(),
    tavily: hasTavilyKey(),
    models: { fast: models.fast, reason: models.reason, ultra: models.ultra, baseUrl: models.baseUrl },
    hackathon: "Nebius x NVIDIA Global AI Hackathon",
  };
  if (req.nextUrl.searchParams.get("probe")) {
    const probe: Record<string, unknown> = {};
    if (hasNebiusKey()) {
      try {
        const r = await chat(models.fast, [{ role: "user", content: "Reply with the word OK." }], { max_tokens: 20 });
        probe.token_factory = { ok: true, model: models.fast, latency_ms: r.usage.latency_ms, tokens: r.usage.prompt_tokens + r.usage.completion_tokens };
      } catch (e) {
        probe.token_factory = { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "failed" };
      }
    }
    if (hasTavilyKey()) {
      const t0 = Date.now();
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getTavilyKey()}` },
          body: JSON.stringify({ query: "utility duplicate bill", max_results: 1 }),
        });
        probe.tavily = { ok: res.ok, status: res.status, latency_ms: Date.now() - t0 };
      } catch (e) {
        probe.tavily = { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "failed" };
      }
    }
    body.probe = probe;
  }
  return NextResponse.json(body);
}
