"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Usage = { model: string; prompt_tokens: number; completion_tokens: number; latency_ms: number; cost_usd?: number; measured: boolean };
type Receipt = {
  measured: boolean;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  routed_cost_usd: number;
  all_ultra_repriced_usd: number;
  savings_pct: number;
  tavily_credits: number;
  per_model: { model: string; calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number }[];
  prices_as_of: string;
  price_source: string;
};
type Summary = { auto?: number; escalated?: number; investigated?: number };
type TimelineStep = { id: string; kind: string; title: string; detail?: string; model?: string; usage?: Usage; ms?: number };
type Citation = { n: number; title: string; url: string };
type UltraReview = { verdict: string; unsupported_claims: string[]; final_recommendation: string; reason: string; model: string };
type Brief = {
  bill_id: string;
  headline: string;
  situation: string;
  why_it_matters: string;
  recommended_action: string;
  questions_for_humans?: string[];
  research_summary?: string;
  speakable: string;
  model_used: string;
  mode: string;
  citations?: Citation[];
  ultra_review?: UltraReview;
};
type BillRow = { id: string; payee: string; amount: number; due_date: string; category: string; decision: string; handled?: boolean; needs_decision?: boolean };
type Status = {
  mode?: "live" | "partial" | "offline";
  token_factory?: boolean;
  tavily?: boolean;
  models?: { fast?: string; reason?: string; ultra?: string };
  household?: { name?: string };
  bills?: BillRow[];
  briefs?: Record<string, Brief>;
  last_timeline?: TimelineStep[];
  last_receipt?: Receipt | null;
  last_duration_ms?: number | null;
  runtime?: { last_summary?: Summary };
};
type Investigate = { mode?: string; run_mode?: "live" | "degraded" | "offline"; fallbacks?: string[]; summary?: Summary; timeline?: TimelineStep[]; receipt?: Receipt; duration_ms?: number; results?: { bill_id: string; brief?: Brief; reasons?: string[]; action?: string }[] };
type Bench = { ok: boolean; error?: string; complete?: boolean; tavily_credits?: number; routed?: { cost_usd: number; tokens: number; duration_ms: number }; all_ultra?: { cost_usd: number; tokens: number; duration_ms: number }; savings_pct?: number | null; measured_at?: string };

const SUGGESTIONS = ["Run full quiet investigation", "Is the second PG&E a duplicate?", "Brief me on the dental bill", "What can auto-handle tonight?"];

const usd = (n?: number) => (n === undefined || n === null ? "n/a" : n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`);
const short = (m?: string) => (m ? m.split("/").pop() : "");

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [inv, setInv] = useState<Investigate | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [goal, setGoal] = useState(SUGGESTIONS[0]);
  const [bench, setBench] = useState<Bench | null>(null);
  const [benchBusy, setBenchBusy] = useState(false);
  const briefRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus(await res.json());
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load status");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const post = async (body: Record<string, unknown>, ms: number) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      return data as Investigate;
    } finally {
      clearTimeout(timer);
    }
  };

  const run = async (customGoal?: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    const body = { goal: customGoal || goal, reset: true };
    try {
      let data: Investigate;
      try {
        data = await post(body, 58_000);
      } catch {
        // Live providers did not answer in time (or the function was cut off): show the labeled offline run instead of an error.
        data = await post({ ...body, offline: true }, 20_000);
        data = { ...data, run_mode: "degraded", fallbacks: ["Live providers did not answer in time, so this is the labeled offline run. Press Run again to retry live.", ...(data.fallbacks || [])] };
      }
      setInv(data);
      type R = { bill_id: string; brief?: Brief; reasons?: string[] };
      const withBriefs: R[] = (data.results || []).filter((r: R) => r.brief);
      const pickBrief =
        withBriefs.find((r) => r.brief?.ultra_review) ||
        [...withBriefs].sort((a, b) => (b.reasons?.length || 0) - (a.reasons?.length || 0))[0];
      if (pickBrief) setSelected(pickBrief.bill_id);
      refresh();
      setTimeout(() => briefRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    } catch {
      setNote("Could not reach the app server. Check your connection and press Run again.");
    } finally {
      setBusy(false);
    }
  };

  const runBench = async () => {
    setBenchBusy(true);
    try {
      const res = await fetch("/api/benchmark", { method: "POST" });
      setBench(await res.json());
    } catch {
      setBench({ ok: false, error: "The benchmark did not finish in time. The figures in the README are from a recorded run." });
    } finally {
      setBenchBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await fetch("/api/reset", { method: "POST" });
      setInv(null);
      setSelected(null);
      setBench(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const mode = status?.mode || "offline";
  // The banner reflects what the last run actually did; before any run, it reflects which providers are configured.
  const bannerMode = inv?.run_mode || (mode === "live" ? "live" : mode === "partial" ? "degraded" : "offline");
  // Prefer data from the run response itself: on serverless, /api/status may hit a different instance.
  const briefs = useMemo(() => {
    const fromRun: Record<string, Brief> = {};
    for (const r of inv?.results || []) if (r.brief) fromRun[r.bill_id] = r.brief;
    return Object.keys(fromRun).length ? fromRun : status?.briefs || {};
  }, [inv, status]);
  const active = selected ? briefs[selected] : null;
  const bills = useMemo(() => {
    const rows = status?.bills || [];
    if (!inv?.results) return rows;
    return rows.map((b) => {
      const r = inv.results!.find((x) => x.bill_id === b.id);
      return r ? { ...b, handled: r.action === "auto_handled", needs_decision: r.action === "escalated" } : b;
    });
  }, [inv, status]);
  const timeline = inv?.timeline || status?.last_timeline || [];
  const receipt = inv?.receipt || status?.last_receipt || null;
  const duration = inv?.duration_ms ?? status?.last_duration_ms ?? null;
  const summary = useMemo(() => inv?.summary || status?.runtime?.last_summary || { auto: 0, escalated: 0, investigated: 0 }, [inv, status]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {(status || inv) && <ModeBanner mode={bannerMode} tf={!!status?.token_factory} tv={!!status?.tavily} fallbacks={inv?.fallbacks || []} />}

      <header className="mb-6 mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.18em] uppercase text-[var(--sage)]">Nebius × NVIDIA · Best Apps and Agents</p>
          <h1 className="display mt-2 text-4xl sm:text-5xl font-semibold tracking-tight text-[var(--ink)]">Northbridge Brief</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)] text-lg leading-relaxed">
            A quiet household agent for Avery &amp; Morgan. Routine bills get handled silently. Real decisions get one short brief with
            cited web sources, and you can see which Nemotron model did each step and what it cost.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Runtime status">
          <span className={`pill ${status?.token_factory ? "pill-ok" : "pill-warn"}`}>{status?.token_factory ? "Token Factory: live" : "Token Factory: off"}</span>
          <span className={`pill ${status?.tavily ? "pill-ok" : "pill-warn"}`}>{status?.tavily ? "Tavily: live" : "Tavily: off (fixtures)"}</span>
        </div>
      </header>

      {note && (
        <div role="status" className="mb-6 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--muted)]">
          {note}
        </div>
      )}
      {error && !inv && (
        <div role="alert" className="mb-6 rounded-xl border border-[var(--warn)] bg-[#fbeeea] px-4 py-3 text-[var(--warn)]">
          {error}
        </div>
      )}

      {/* Onboarding: 30-second path */}
      <section className="card mb-6 p-5 sm:p-6" aria-labelledby="start-here">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 id="start-here" className="display text-2xl">Start here (about 30 seconds)</h2>
            <ol className="mt-2 grid gap-1 text-[var(--muted)] sm:grid-cols-3 sm:gap-4">
              <li><strong className="text-[var(--ink)]">1.</strong> Press <em>Run the demo</em>. Six household bills are checked.</li>
              <li><strong className="text-[var(--ink)]">2.</strong> Rules handle routine bills with zero model tokens.</li>
              <li><strong className="text-[var(--ink)]">3.</strong> Read the escalated brief: sources, model per step, cost.</li>
            </ol>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost whitespace-nowrap" onClick={reset} disabled={busy}>Reset</button>
            <button className="btn btn-primary text-lg px-6 whitespace-nowrap" onClick={() => run(SUGGESTIONS[0])} disabled={busy} aria-busy={busy}>
              {busy ? (mode === "offline" ? "Running…" : "Calling Nemotron + Tavily…") : "Run the demo"}
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-live="polite">
          <Stat label="Bills checked" value={String(summary.investigated || 0)} />
          <Stat label="Auto-handled" value={String(summary.auto || 0)} tone="ok" />
          <Stat label="Escalated" value={String(summary.escalated || 0)} tone="warn" />
          <Stat label="Run cost" value={receipt?.measured ? usd(receipt.routed_cost_usd) : mode === "offline" ? "offline" : "–"} sub={duration ? `${(duration / 1000).toFixed(1)}s` : undefined} />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div ref={briefRef} className="card p-5 sm:p-6" aria-labelledby="brief-h">
            <h2 id="brief-h" className="display text-2xl">Decision brief</h2>
            {!active && <p className="mt-3 text-[var(--muted)]">Run the demo. The highest-stakes escalation opens here with its sources.</p>}
            {active && <BriefCard b={active} />}
            {Object.keys(briefs).length > 1 && (
              <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Other briefs">
                {Object.values(briefs).map((b) => (
                  <button key={b.bill_id} role="tab" aria-selected={b.bill_id === selected} className={`pill ${b.bill_id === selected ? "pill-ok" : ""}`} onClick={() => setSelected(b.bill_id)}>
                    {bills.find((x) => x.id === b.bill_id)?.payee || b.bill_id}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 sm:p-6">
            <h2 className="display text-2xl">Agent trace</h2>
            <p className="text-[var(--muted)] mt-1 mb-4">Every step, the model or tool that ran it, tokens, latency and cost.</p>
            <div className="max-h-[560px] space-y-2 overflow-auto pr-2">
              {timeline.length === 0 && <p className="text-[var(--muted)]">No run yet.</p>}
              {timeline.map((s) => (
                <div key={s.id} className="rounded-xl bg-white/50 px-3 py-2.5 border border-[var(--line)]/70">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="pill">{s.kind}</span>
                    <strong>{s.title}</strong>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs mono text-[var(--muted)]">
                    {s.model && <span>{short(s.model)}</span>}
                    {s.usage && <span>{s.usage.prompt_tokens}→{s.usage.completion_tokens} tok</span>}
                    {s.usage?.cost_usd !== undefined && <span>{usd(s.usage.cost_usd)}</span>}
                    {s.ms !== undefined && <span>{s.ms} ms</span>}
                  </div>
                  {s.detail && <p className="mt-1 text-sm text-[var(--muted)] whitespace-pre-wrap">{s.detail}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5 sm:p-6" aria-labelledby="receipt-h">
            <h2 id="receipt-h" className="display text-2xl">Cost receipt</h2>
            {!receipt?.measured ? (
              <p className="mt-3 text-[var(--muted)]">
                {mode === "offline" || !status?.token_factory
                  ? "Offline demo: no Token Factory calls, so there are no token counts. Numbers appear here only when they come from the API."
                  : "Run the demo to get a receipt built from API-reported token usage."}
              </p>
            ) : (
              <div className="mt-3 space-y-3 text-sm">
                <table className="w-full text-left">
                  <caption className="sr-only">Per-model token usage</caption>
                  <thead className="text-[var(--muted)]"><tr><th>Model</th><th>Calls</th><th>Tokens in→out</th><th>Cost</th></tr></thead>
                  <tbody className="mono">
                    {receipt.per_model.map((r) => (
                      <tr key={r.model}><td>{short(r.model)}</td><td>{r.calls}</td><td>{r.prompt_tokens}→{r.completion_tokens}</td><td>{usd(r.cost_usd)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="rounded-xl border border-[var(--line)] bg-[#f7faf6] p-3">
                  <div><strong>Routed (Nano → Super → Ultra on high stakes):</strong> {usd(receipt.routed_cost_usd)}</div>
                  <div><strong>Same tokens, all on Ultra:</strong> {usd(receipt.all_ultra_repriced_usd)} <span className="text-[var(--muted)]">({receipt.savings_pct}% saved)</span></div>
                  <div className="mt-1 text-xs text-[var(--muted)]">Re-priced at list rates, not a second run. Tavily credits this run: {receipt.tavily_credits}. Prices from <a className="underline" href={receipt.price_source}>Token Factory</a>, {receipt.prices_as_of}.</div>
                </div>
                <div>
                  <button className="btn btn-ghost" onClick={runBench} disabled={benchBusy}>{benchBusy ? "Running both…" : "Measure vs an all-Ultra run"}</button>
                  {bench && !bench.ok && <p className="mt-2 text-[var(--warn)]">{bench.error}</p>}
                  {bench?.ok && (
                    <p className="mt-2">
                      Measured side by side: routed {usd(bench.routed?.cost_usd)} ({bench.routed?.tokens} tok, {((bench.routed?.duration_ms || 0) / 1000).toFixed(1)}s) vs all-Ultra {usd(bench.all_ultra?.cost_usd)} ({bench.all_ultra?.tokens} tok, {((bench.all_ultra?.duration_ms || 0) / 1000).toFixed(1)}s). <strong>{bench.savings_pct}% cheaper.</strong>{bench.complete === false ? " (One step fell back, so this pair is not like-for-like; run again.)" : ""}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="card p-5 sm:p-6">
            <h2 className="display text-2xl">Household ledger</h2>
            <p className="text-[var(--muted)] mt-1 mb-4">{status?.household?.name || "Northbridge"} · pseudonymous demo data</p>
            <div className="space-y-2">
              {bills.map((b) => (
                <button key={b.id} onClick={() => briefs[b.id] && setSelected(b.id)} className="w-full text-left rounded-xl border border-[var(--line)] bg-white/60 px-3 py-3 hover:border-[var(--sage)] transition">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{b.payee}</div>
                      <div className="text-sm text-[var(--muted)]">${Number(b.amount).toFixed(2)} · due {b.due_date} · {b.category}</div>
                    </div>
                    <span className={`pill ${b.decision === "AUTO" ? "pill-ok" : "pill-warn"}`}>{b.handled ? "auto-handled" : b.needs_decision ? "brief ready" : b.decision === "AUTO" ? "routine" : "needs you"}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5 sm:p-6">
            <h2 className="display text-xl">Which model does what</h2>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
              <li><strong className="text-[var(--ink)]">Policy gate:</strong> deterministic rules, no LLM, no tokens.</li>
              <li><strong className="text-[var(--ink)]">Plan:</strong> {short(status?.models?.fast)} (cheapest, fast).</li>
              <li><strong className="text-[var(--ink)]">Research:</strong> Tavily search (advanced) + extract on top sources.</li>
              <li><strong className="text-[var(--ink)]">Brief:</strong> {short(status?.models?.reason)} writes it with [n] citations.</li>
              <li><strong className="text-[var(--ink)]">Escalation review:</strong> {short(status?.models?.ultra)} checks high-stakes briefs against sources.</li>
            </ul>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-[var(--sage)]">Ask a custom goal</summary>
              <div className="mt-2 flex flex-col gap-2">
                <label htmlFor="goal" className="sr-only">Goal</label>
                <input id="goal" className="rounded-xl border border-[var(--line)] bg-white/70 px-3 py-2" value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="pill" onClick={() => { setGoal(s); run(s); }} disabled={busy}>{s}</button>
                  ))}
                </div>
              </div>
            </details>
          </div>
        </div>
      </section>

      <footer className="mt-10 border-t border-[var(--line)] pt-6 text-sm text-[var(--muted)]">
        Northbridge Brief · Apache-2.0 · <a className="underline" href="https://github.com/dl88jing/northbridge-nebius-brief">Source</a> · Pseudonymous demo household (Avery &amp; Morgan). No real financial data.
      </footer>
    </main>
  );
}

function ModeBanner({ mode, tf, tv, fallbacks }: { mode: string; tf: boolean; tv: boolean; fallbacks: string[] }) {
  if (mode === "live") {
    return (
      <div role="status" className="rounded-xl border border-[var(--ok)] bg-[#e9f3ec] px-4 py-2 text-sm text-[var(--ok)]">
        <strong>LIVE.</strong> Each run calls NVIDIA Nemotron on Nebius Token Factory and Tavily search + extract. Token counts and costs come from the APIs.
      </div>
    );
  }
  if (mode === "degraded") {
    return (
      <div role="status" className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm text-[var(--muted)]">
        <strong className="text-[var(--ink)]">LIVE, with a labeled fallback.</strong> Most steps ran on Token Factory and Tavily; the steps below used a labeled template or fixture instead, and they are marked in the trace.
        {fallbacks.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {fallbacks.slice(0, 4).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div role="status" className="rounded-xl border-2 border-[var(--copper)] bg-[#fbf0e4] px-4 py-3 text-sm text-[#7a3f17]">
      <strong>OFFLINE DEMO.</strong>{" "}
      {tf ? "" : "No Token Factory calls: plans and briefs come from templates. "}
      {tv ? "" : "No Tavily calls: sources are labeled fixtures (example.com links)."} The rules engine, UI and trace are real; model output and costs are not.
    </div>
  );
}

function BriefCard({ b }: { b: Brief }) {
  const live = b.mode === "live";
  const liveSources = (b.citations || []).some((c) => !c.url.includes("example.com"));
  return (
    <article className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <span className="pill pill-warn">Needs you</span>
        <span className={`pill ${live ? "pill-ok" : "pill-warn"}`}>{live ? "live model output" : b.mode === "fallback" ? "fallback template (live call failed)" : "offline template"}</span>
        <span className="pill mono">{short(b.model_used)}</span>
      </div>
      <h3 className="display text-xl">{b.headline}</h3>
      <div className="rounded-xl bg-[var(--sage-deep)] text-[#f3f7f3] p-4">
        <div className="text-xs uppercase tracking-[0.16em] opacity-80 mb-1">What to do</div>
        {b.ultra_review?.final_recommendation || b.recommended_action}
      </div>
      <p>{b.situation}</p>
      <p className="text-[var(--muted)]"><strong className="text-[var(--ink)]">Why it matters:</strong> {b.why_it_matters}</p>
      {b.research_summary && <p className="text-sm"><strong>Research:</strong> {b.research_summary}</p>}
      {b.citations && b.citations.length > 0 && (
        <div className="rounded-xl border border-[var(--line)] bg-[#f7faf6] p-3 text-sm">
          <strong>Sources {liveSources ? "(Tavily)" : "(offline fixtures)"}</strong>
          <ol className="mt-1 space-y-1">
            {b.citations.map((c) => (
              <li key={c.n}>[{c.n}] <a className="underline break-all" href={c.url} target="_blank" rel="noreferrer">{c.title}</a></li>
            ))}
          </ol>
        </div>
      )}
      {b.ultra_review && (
        <div className="rounded-xl border border-[var(--sky)] bg-[#eef3f6] p-3 text-sm">
          <strong>Escalation review by {short(b.ultra_review.model)}: {b.ultra_review.verdict}</strong>
          <p className="mt-1">{b.ultra_review.reason}</p>
          {b.ultra_review.unsupported_claims.length > 0 && (
            <ul className="mt-1 list-disc pl-5">{b.ultra_review.unsupported_claims.map((c) => <li key={c}>Unsupported: {c}</li>)}</ul>
          )}
        </div>
      )}
      <p className="text-sm italic text-[var(--muted)]">Spoken version: “{b.speakable}”</p>
    </article>
  );
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: "ok" | "warn"; sub?: string }) {
  const color = tone === "ok" ? "text-[var(--ok)]" : tone === "warn" ? "text-[var(--warn)]" : "text-[var(--ink)]";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white/60 px-3 py-3">
      <div className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">{label}</div>
      <div className={`display text-3xl mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-[var(--muted)] mono">{sub}</div>}
    </div>
  );
}
