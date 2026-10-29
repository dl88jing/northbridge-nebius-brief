# Northbridge Brief

A quiet household agent built for the **Nebius × NVIDIA Global AI Hackathon** (Best Apps and Agents). Routine bills are handled silently. When a real decision is needed, it writes one short brief with cited web sources, and shows which NVIDIA Nemotron model did each step and what it cost.

The demo household (Avery & Morgan) and all bills are fictional.

- **Live app:** https://northbridge-nebius-brief.vercel.app
- **Pitch deck:** [docs/pitch-deck.pdf](docs/pitch-deck.pdf)
- **Architecture:** [docs/architecture.md](docs/architecture.md)
- **Live evaluation (5 runs on production):** [docs/live-eval.md](docs/live-eval.md)

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/dl88jing/northbridge-nebius-brief/actions/workflows/ci.yml/badge.svg)](https://github.com/dl88jing/northbridge-nebius-brief/actions/workflows/ci.yml)
[![Live health](https://github.com/dl88jing/northbridge-nebius-brief/actions/workflows/live-health.yml/badge.svg)](https://github.com/dl88jing/northbridge-nebius-brief/actions/workflows/live-health.yml)

> **Current deployment status (checked Oct 29, 2026):** the live URL runs **live** on Nebius Token Factory (Nemotron 3 Nano, Super, Ultra) and Tavily. Check it yourself at [`/api/health?probe=1`](https://northbridge-nebius-brief.vercel.app/api/health?probe=1). A full production run that morning: 6 bills (2 auto, 4 escalated), no fallbacks, 12.5 s, $0.00448 measured, 8 fresh Tavily credits. A [Live health](.github/workflows/live-health.yml) check runs every 6 hours. If a provider fails, times out or runs out of credits, that step uses a labeled fallback and the run still completes; the banner and trace say so.

---

## Try it in 30 seconds

Open the live app and press **Run the demo**. The page:

1. checks six bills against deterministic rules (rent and fiber are auto-handled, no tokens spent),
2. opens the highest-stakes escalation (a dental bill) as a brief with numbered sources,
3. shows the agent trace: every step, the model or tool that ran it, tokens, latency and cost.

Or locally:

```bash
git clone https://github.com/dl88jing/northbridge-nebius-brief.git
cd northbridge-nebius-brief
./demo.sh          # one command: installs deps, runs the agent end to end in the terminal
./demo.sh dev      # dashboard at http://127.0.0.1:3000
npm test           # unit + agent tests, no keys or network needed
```

To run live, copy `.env.example` to `.env.local` and set `NEBIUS_API_KEY` and `TAVILY_API_KEY`.

### For judges: verify the live calls from a terminal

```bash
# 1. Mode and keys (booleans only), plus one real Token Factory call and one real Tavily search
curl -s "https://northbridge-nebius-brief.vercel.app/api/health?probe=1" | jq '{mode, probe}'

# 2. One full agent run (~10-20 s): fallbacks should be [], tavily_credits > 0 on a cold cache
curl -s -X POST https://northbridge-nebius-brief.vercel.app/api/investigate \
  -H 'content-type: application/json' -d '{"reset":true}' \
  | jq '{run_mode, fallbacks, summary, cost_usd: .receipt.routed_cost_usd, tavily_credits: .receipt.tavily_credits, per_model: [.receipt.per_model[] | {model, calls, cost_usd}]}'
```

Tavily results are cached per server instance for 6 hours, so a repeat run can report 0 credits; the sources in each brief are still the real URLs Tavily returned.

---

## How the sponsors' platforms are used

![Architecture](docs/architecture.png)

| Step | Runs on | Why |
|------|---------|-----|
| Policy gate (AUTO vs HUMAN_REQUIRED) | Deterministic rules | Money decisions should not depend on a model. Zero tokens. |
| Investigation plan | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` on Token Factory | Cheapest model for a short plan. |
| Web research | Tavily `/search` (advanced, top 5) + `/extract` on the top 3 pages, reranked against the question | The brief can quote real passages, not just snippets. |
| Decision brief | `nvidia/nemotron-3-super-120b-a12b` on Token Factory | JSON brief; every factual claim cites `[n]` from the sources. |
| Escalation review | `nvidia/Nemotron-3-Ultra-550b-a55b` on Token Factory | Only for high-stakes escalations (medical/tax/legal, multiple rules, or ≥ $500). Confirms or revises the recommendation and lists unsupported claims. |

**Cost receipt.** Every Token Factory call records the API-reported `prompt_tokens` and `completion_tokens`, multiplied by Token Factory list prices (public catalog, read 2026-10-25, in [`lib/pricing.ts`](lib/pricing.ts)). The UI shows cost per step and per model, plus what the same tokens would cost on Ultra. That second number is a repricing, not a second run, and is labeled that way. For a measured comparison, `POST /api/benchmark` runs the routed pipeline and an all-Ultra pipeline side by side and returns both real costs (our recorded run: [`docs/live-measurements.json`](docs/live-measurements.json)). Tavily credits come from the API's `usage` field.

**Measured on the production deployment, Oct 25, 2026** (single runs, not averages):

| | Routed (Nano → Super → Ultra on high stakes) | Every step on Ultra |
|---|---|---|
| `POST /api/benchmark`, same sources | **$0.00459**, 8,066 tokens, 6 calls | **$0.01327**, 8,651 tokens, 6 calls |
| Saving | **65.4% cheaper** | |

A normal full pass (6 bills: 2 auto-handled with zero tokens, 4 escalated) costs about **$0.0045**, takes about 8–11 s with fresh web research, and uses 9 Tavily credits. The in-app repricing of the same tokens on Ultra shows 59–61% savings. No cost figures are shown in offline mode.

**Repeated runs, Oct 27, 2026** ([`docs/live-eval.md`](docs/live-eval.md), reproduce with `node scripts/eval-live.mjs`): 5 back-to-back full runs on the production URL, all 5 fully live with no fallback, identical policy decisions every run, mean measured cost **$0.00446 per run** (same tokens repriced on Ultra: $0.01179, 62.2% saving), mean 7.2 s server time. All 20 briefs had real web sources, and all 76 inline `[n]` citations pointed at a listed source. These runs reused cached Tavily results (0 credits), so they show model latency and cost, not fresh-research latency; the first cold run that morning took 18.4 s and 7 Tavily credits.

Models and endpoint can be overridden with `NEMOTRON_FAST_MODEL`, `NEMOTRON_REASON_MODEL`, `NEMOTRON_ULTRA_MODEL`, `NEBIUS_BASE_URL` (default `https://api.tokenfactory.us-central1.nebius.com/v1/`, falls back to `https://api.tokenfactory.nebius.com/v1/`).

---

## Modes

| Mode | When | What you see |
|------|------|--------------|
| `live` | Both keys set | Real Nemotron output, real Tavily sources, measured cost receipt. Green banner. |
| `partial` | One key set | Live part is real, the other part is labeled offline. Amber banner. |
| `offline` | No keys | Templates + fixture sources (example.com links), no costs. Amber "OFFLINE DEMO" banner. |

**Fallbacks (keys set, a provider fails).** Every live call has a deadline (the whole run is budgeted to about 48 s, under Vercel's 60 s limit). If Token Factory or Tavily errors, times out, rate-limits or runs out of credits, that step uses a labeled template or fixture, the trace says why, and the banner reads "LIVE, with a labeled fallback" instead of LIVE. If the request itself fails, the page retries with `{"offline": true}` and shows the labeled offline run, never an error. Nemotron 3 thinking is turned off per request (`chat_template_kwargs: {enable_thinking: false}`) to keep latency and tokens down; model JSON gets a lenient repair and one bounded retry. Tavily results are cached per instance for 6 hours, and bills asking the same question share one search.

`GET /api/health` reports the mode and which keys are present (booleans only). `GET /api/health?probe=1` makes one tiny Token Factory call and one Tavily search and reports success and latency.

---

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Mode, key presence, models. `?probe=1` for a live check. |
| `GET /api/status` | Household, bills, briefs, last trace and receipt |
| `POST /api/investigate` | Run the agent (`{ goal?, billIds?, reset? }`) |
| `POST /api/benchmark` | Live only: routed vs all-Ultra, measured side by side |
| `GET/POST /api/brief` | Read or regenerate one brief |
| `POST /api/reset` | Clear runtime state |

---

## Tests

`npm test` (Node's test runner via `tsx`), no keys or network. 23 tests:

- policy gate: golden decision table for all six fixture bills (decision, rule ids, research flag), plus edge cases: band edges and one cent outside, funding shortfall below the reserve floor, unknown funding account, every sensitive and every allow-listed category, determinism,
- pricing math and receipt (only measured calls count; Ultra repricing),
- JSON extraction from model output with `<think>` blocks and code fences,
- offline run: zero network calls, every research step labeled OFFLINE, no cost reported, every brief has sources,
- provider failure (Token Factory throws, Tavily returns 432 credit limit): the run still completes, every brief is a labeled fallback with sources, `run_mode` is `degraded`, and the reason reads "out of credits",
- `offline: true` with keys set: zero network calls,
- live path with a fake Token Factory client and fake Tavily server: Nano plans, Super briefs, Ultra reviews the dental bill, citations point at Tavily URLs, receipt is measured, Tavily credits add up,
- `/api/status` never contains key values.

`npm run check` runs typecheck, lint and tests. GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs typecheck, lint, tests and `next build` on every push, with no API keys.

---

## Limitations

- **Small samples.** The benchmark table is a single run; the repeated-run numbers are 5 runs on one fictional household. Citation checks are mechanical (each `[n]` resolves to a real URL), not a judgment of source quality; for example, a PG&E search can still surface a different utility's page, which is why a human reviews every brief.
- **Fixture data.** Six fictional bills; no bank, email or biller integration. Nothing is ever paid.
- **Rules are simple.** Expected-amount bands and duplicate detection are hand-set per bill.
- **Prices are list prices** copied on 2026-10-25; Token Factory may change them. Unknown models show "n/a" instead of a guess.
- **State is per server instance** (`/tmp` on Vercel), so runs are not shared between visitors reliably.
- **Ultra review adds latency** (it is the largest model), which is why it only runs on high-stakes escalations.

## Accessibility (current and next)

Current: semantic headings, `role="status"` mode banner, `aria-live` run summary, labeled inputs, a table caption for the receipt, and text labels next to every color pill.

Next: keyboard focus styles audit, reduced-motion support for scrolling, a screen-reader pass with VoiceOver/NVDA, and reading the speakable brief aloud with TTS.

---

## Repo layout

```
app/                Next.js App Router UI + API routes
lib/agent.ts        Agent loop: plan → tools → policy → research → brief → Ultra review → receipt
lib/llm.ts          Token Factory client, usage + latency capture
lib/pricing.ts      Token Factory list prices
lib/tavily.ts       Tavily search + extract
lib/nemotron.ts     Plan, cited brief, Ultra review, offline templates
data/               Fictional household fixtures + offline research
tests/              node:test suites
scripts/demo.ts     Terminal demo (./demo.sh)
scripts/eval-live.mjs  Repeated-run evaluation against a deployment -> docs/live-eval.{md,json}
docs/               Architecture (SVG/PNG/MD), pitch deck
```

---

## Feedback for Nebius, NVIDIA and Tavily

- **Token Factory:** the OpenAI-compatible API meant the live path is one client with a different base URL. Returning `usage` on every call made the per-step cost receipt easy. It took searching to learn that models live in different regions (Nano in eu-north1, Super/Ultra in us-central1) with different base URLs; one endpoint that routes by model, or a clear region column in the catalog, would save time. A machine-readable price list exists at `/api/public/models_info`, which we used; linking it from the docs would help.
- **Nemotron:** Nano → Super → Ultra is a natural ladder for agents. Some responses include reasoning text before the JSON, so we strip `<think>` blocks. A documented "JSON only" switch per model would remove that step.
- **Tavily:** `search` + `extract` with `query` reranking and `chunks_per_source` gives short, relevant passages that fit in a brief prompt. `include_usage` for credits is great for showing cost. An option to have search return the extracted chunks directly would save one round trip.

## License

Apache-2.0. See [LICENSE](LICENSE).
