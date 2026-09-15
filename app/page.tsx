"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Status = {
  token_factory?: boolean;
  tavily?: boolean;
  models?: { fast?: string; reason?: string };
  household?: { name?: string };
  bills?: BillRow[];
  briefs?: Record<string, Brief>;
  last_timeline?: TimelineStep[];
  last_results?: unknown[];
  runtime?: { last_summary?: Summary };
  mode?: string;
};

type Investigate = {
  ok?: boolean;
  mode?: string;
  summary?: Summary;
  results?: { bill_id: string; brief?: Brief }[];
  timeline?: TimelineStep[];
  token_factory?: boolean;
  tavily?: boolean;
  models?: { fast?: string; reason?: string };
  household?: string;
};

type Summary = { auto?: number; escalated?: number; investigated?: number };
type TimelineStep = { id: string; kind: string; title: string; detail?: string; model?: string };
type Brief = {
  headline: string;
  situation: string;
  why_it_matters: string;
  recommended_action: string;
  questions_for_humans?: string[];
  research_summary?: string;
  speakable: string;
  model_used: string;
  mode: string;
};
type BillRow = {
  id: string;
  payee: string;
  amount: number;
  due_date: string;
  category: string;
  decision: string;
  handled?: boolean;
  needs_decision?: boolean;
};

const SUGGESTIONS = [
  "Run full quiet investigation",
  "Why is StreamFlix escalating?",
  "Is the second PG&E a duplicate?",
  "Brief me on Bayview Dental",
  "What can auto-handle tonight?",
];

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [investigate, setInvestigate] = useState<Investigate | null>(null);
  const [selectedBrief, setSelectedBrief] = useState<string | null>(null);
  const [goal, setGoal] = useState(SUGGESTIONS[0]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setError(null);
      if (data.last_results?.length) {
        setInvestigate({
          ok: true,
          mode: data.mode,
          summary: data.runtime?.last_summary,
          results: data.last_results,
          timeline: data.last_timeline,
          token_factory: data.token_factory,
          tavily: data.tavily,
          models: data.models,
          household: data.household?.name,
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load status");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (customGoal?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/investigate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: customGoal || goal, reset: true }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Investigation failed");
      }
      setInvestigate(data);
      const firstEsc = data.results?.find((r: { brief?: Brief; bill_id: string }) => r.brief);
      if (firstEsc) setSelectedBrief(firstEsc.bill_id);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Investigation failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await fetch("/api/reset", { method: "POST" });
      setInvestigate(null);
      setSelectedBrief(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const briefs = status?.briefs || {};
  const activeBrief = selectedBrief ? briefs[selectedBrief] : null;
  const bills = status?.bills || [];
  const timeline = investigate?.timeline || status?.last_timeline || [];

  const summary = useMemo(() => {
    return (
      investigate?.summary ||
      status?.runtime?.last_summary || { auto: 0, escalated: 0, investigated: 0 }
    );
  }, [investigate, status]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.18em] uppercase text-[var(--sage)]">
            Nebius × NVIDIA · Best Apps and Agents
          </p>
          <h1 className="display mt-2 text-4xl sm:text-5xl font-semibold tracking-tight text-[var(--ink)]">
            Northbridge Brief
          </h1>
          <p className="mt-3 max-w-2xl text-[var(--muted)] text-lg leading-relaxed">
            Quiet research/ops agent for Avery & Morgan Quinn. Nemotron on Nebius
            Token Factory investigates household anomalies, gates with policy,
            researches the web, and only pings humans when a decision is real.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`pill ${status?.token_factory ? "pill-ok" : "pill-info"}`}>
            {status?.token_factory ? "Token Factory live" : "Offline demo mode"}
          </span>
          <span className={`pill ${status?.tavily ? "pill-ok" : "pill-info"}`}>
            {status?.tavily ? "Tavily live" : "Tavily fixtures"}
          </span>
          <span className="pill pill-info mono">
            {status?.models?.reason?.split("/").pop() || "Nemotron"}
          </span>
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-xl border border-[color-mix(in_oklab,var(--warn)_35%,var(--line))] bg-[color-mix(in_oklab,var(--warn)_8%,white)] px-4 py-3 text-[var(--warn)]">
          {error}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <div className="card p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="display text-2xl">Investigation desk</h2>
                <p className="text-[var(--muted)] mt-1">
                  Multi-step agent: plan → bills → policy → research → Nemotron brief → escalate/auto.
                </p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-ghost" onClick={reset} disabled={busy}>
                  Reset
                </button>
                <button className="btn btn-primary" onClick={() => run()} disabled={busy}>
                  {busy ? "Investigating…" : "Run quiet pass"}
                </button>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              <label className="text-sm font-semibold text-[var(--muted)]">Goal</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  className="flex-1 rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none focus:border-[var(--sage)]"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                />
                <button className="btn btn-primary" onClick={() => run()} disabled={busy}>
                  Investigate
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="pill hover:border-[var(--sage)]"
                    onClick={() => {
                      setGoal(s);
                      run(s);
                    }}
                    disabled={busy}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <Stat label="Investigated" value={summary.investigated || 0} />
              <Stat label="Auto-handled" value={summary.auto || 0} tone="ok" />
              <Stat label="Escalated" value={summary.escalated || 0} tone="warn" />
            </div>
          </div>

          <div className="card p-5 sm:p-6">
            <h2 className="display text-2xl">Agent timeline</h2>
            <p className="text-[var(--muted)] mt-1 mb-4">
              Tool calls, quiet policy gate, Tavily research, and Nemotron briefs — not a chat wrapper.
            </p>
            <div className="max-h-[520px] space-y-3 overflow-auto pr-2">
              {timeline.length === 0 && (
                <p className="text-[var(--muted)]">
                  Run a quiet pass to watch the agent investigate Northbridge anomalies.
                </p>
              )}
              {timeline.map((s: TimelineStep) => (
                <div key={s.id} className="timeline-item rounded-xl bg-white/50 px-3 py-2.5 border border-[var(--line)]/70">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="pill">{s.kind}</span>
                    <strong>{s.title}</strong>
                    {s.model && <span className="mono text-[var(--muted)]">{s.model}</span>}
                  </div>
                  {s.detail && (
                    <p className="mt-1 text-sm text-[var(--muted)] whitespace-pre-wrap">{s.detail}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5 sm:p-6">
            <h2 className="display text-2xl">Household ledger</h2>
            <p className="text-[var(--muted)] mt-1 mb-4">
              {status?.household?.name || "Northbridge"} · Avery & Morgan Quinn · escalate-only
            </p>
            <div className="space-y-2">
              {bills.map((b: BillRow) => (
                <button
                  key={b.id}
                  onClick={() => setSelectedBrief(b.id)}
                  className="w-full text-left rounded-xl border border-[var(--line)] bg-white/60 px-3 py-3 hover:border-[var(--sage)] transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{b.payee}</div>
                      <div className="text-sm text-[var(--muted)]">
                        ${Number(b.amount).toFixed(2)} · due {b.due_date} · {b.category}
                      </div>
                    </div>
                    <span className={`pill ${b.decision === "AUTO" ? "pill-ok" : "pill-warn"}`}>
                      {b.handled ? "handled" : b.needs_decision ? "brief ready" : b.decision}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="card p-5 sm:p-6">
            <h2 className="display text-2xl">Decision brief</h2>
            {!activeBrief && (
              <p className="mt-3 text-[var(--muted)]">
                Escalations land here with speakable guidance and research citations.
              </p>
            )}
            {activeBrief && (
              <article className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <span className="pill pill-warn">HUMAN_REQUIRED</span>
                  <span className="pill mono">{activeBrief.mode}</span>
                  <span className="pill mono">{activeBrief.model_used}</span>
                </div>
                <h3 className="display text-xl">{activeBrief.headline}</h3>
                <p>{activeBrief.situation}</p>
                <p className="text-[var(--muted)]">
                  <strong className="text-[var(--ink)]">Why it matters:</strong>{" "}
                  {activeBrief.why_it_matters}
                </p>
                <p>
                  <strong>Recommended:</strong> {activeBrief.recommended_action}
                </p>
                {activeBrief.research_summary && (
                  <div className="rounded-xl border border-[var(--line)] bg-[#f7faf6] p-3 text-sm">
                    <strong>Research:</strong> {activeBrief.research_summary}
                  </div>
                )}
                <div className="rounded-xl bg-[var(--sage-deep)] text-[#f3f7f3] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] opacity-80 mb-1">
                    Speakable
                  </div>
                  {activeBrief.speakable}
                </div>
                <ul className="list-disc pl-5 text-sm text-[var(--muted)]">
                  {(activeBrief.questions_for_humans || []).map((q: string) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </article>
            )}
            {!activeBrief && Object.keys(briefs).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.keys(briefs).map((id) => (
                  <button key={id} className="pill" onClick={() => setSelectedBrief(id)}>
                    Open {id}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5 sm:p-6">
            <h2 className="display text-xl">Stack</h2>
            <ul className="mt-3 space-y-2 text-sm text-[var(--muted)]">
              <li>
                <strong className="text-[var(--ink)]">Models:</strong>{" "}
                {status?.models?.fast} (plan) · {status?.models?.reason} (briefs)
              </li>
              <li>
                <strong className="text-[var(--ink)]">Inference:</strong> Nebius Token Factory
                OpenAI-compatible API
              </li>
              <li>
                <strong className="text-[var(--ink)]">Research:</strong> Tavily (+ offline fixtures)
              </li>
              <li>
                <strong className="text-[var(--ink)]">Policy:</strong> escalate-only quiet gate
              </li>
            </ul>
          </div>
        </div>
      </section>

      <footer className="mt-10 border-t border-[var(--line)] pt-6 text-sm text-[var(--muted)]">
        Northbridge Brief · Apache-2.0 · Pseudonymous household demo for the Nebius x NVIDIA Global AI Hackathon.
        Never stores real PII.
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "ok" ? "text-[var(--ok)]" : tone === "warn" ? "text-[var(--warn)]" : "text-[var(--ink)]";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white/60 px-3 py-3">
      <div className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">{label}</div>
      <div className={`display text-3xl mt-1 ${color}`}>{value}</div>
    </div>
  );
}
