# Northbridge Brief

**Nebius × NVIDIA Global AI Hackathon** submission — an **agentic research/ops assistant** that investigates household/admin anomalies for the fictional **Northbridge** home (**Avery & Morgan Quinn**).

Powered by **NVIDIA Nemotron** on **Nebius Token Factory**, with a quiet **escalate-only policy gate**, optional **Tavily** web research, and a live Control Plane dashboard.

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Hackathon](https://img.shields.io/badge/Hackathon-Nebius%20x%20NVIDIA-3f6b4f)](https://nebiusglobalaihackathon.devpost.com/)

---

## Live demo

**Dashboard:** [https://northbridge-nebius-brief.vercel.app](https://northbridge-nebius-brief.vercel.app)

Judge path works fully **offline** with fixture research. Add `NEBIUS_API_KEY` for live Token Factory calls; add `TAVILY_API_KEY` for live web research.

---

## Track recommendation

**Best Apps and Agents** — primary fit.

Northbridge Brief is a product someone would actually use: a quiet household ops agent that researches anomalies and only escalates when policy says `HUMAN_REQUIRED`. It is not a coding sandbox agent (Coding/Agentic Engineering) and not Physical AI.

Optional bonus: **Best Use of Tavily** — research is wired for every escalated anomaly (live key or offline fixtures).

---

## Why this is win-caliber

| Judging lens | What we ship |
|--------------|--------------|
| Technological Implementation | Nemotron Nano (plan) + Super (briefs) via Token Factory OpenAI-compatible API; deterministic policy tools; Tavily research tool |
| Design | Full Control Plane UX — timeline, ledger, speakable briefs — not a thin chatbot |
| Potential Impact | Real household admin pain: bill anomalies, duplicates, medical remittance |
| Quality of idea | Escalate-only agent + researched briefs; credits stretch with Nano for planning, Super for reasoning |

---

## Judge quickstart (~60 seconds, no keys)

```bash
git clone https://github.com/dl88jing/northbridge-nebius-brief.git
cd northbridge-nebius-brief
./demo.sh
```

Expected highlights:

| Decision | Items |
|----------|--------|
| **AUTO** | Cascadia Fiber, Rent |
| **HUMAN_REQUIRED** | StreamFlix (price jump + research), both PG&E notices (duplicate pair), Bayview Dental (medical + research) |

### Interactive dashboard

```bash
./demo.sh dev
# open http://127.0.0.1:3000
```

Click **Run quiet pass** — watch the agent timeline (plan → tools → policy → Tavily → Nemotron brief).

---

## How Nebius Token Factory + Nemotron are used

```
Dashboard / API
      │
      ▼
Investigation agent (lib/agent.ts)
      │
      ├─ Nemotron Nano  → investigation plan     (Token Factory)
      ├─ Deterministic tools → bills, funding, policy gate
      ├─ Tavily (or fixtures) → web research on anomalies
      └─ Nemotron Super → decision brief JSON     (Token Factory)
```

| Role | Model ID (default) | Region notes |
|------|--------------------|--------------|
| Fast planner | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | eu-north1 catalog |
| Reasoned briefs | `nvidia/nemotron-3-super-120b-a12b` | us-central1 catalog |
| API | `https://api.tokenfactory.nebius.com/v1/` | OpenAI-compatible |

Set `NEBIUS_API_KEY` (Token Factory API key). Without it, the same agent loop runs in **offline demo mode** with Nemotron-shaped brief synthesis so judges can evaluate UX and policy without credentials.

Optional overrides:

```bash
export NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1/
export NEMOTRON_FAST_MODEL=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
export NEMOTRON_REASON_MODEL=nvidia/nemotron-3-super-120b-a12b
export TAVILY_API_KEY=tvly-...
```

See `.env.example`.

---

## Architecture

Details: [docs/architecture.md](docs/architecture.md)

**Quiet policy gate** (deterministic, not LLM-decided):

1. Amount outside expected band → `HUMAN_REQUIRED` + research  
2. Duplicate payee/amount/due → `HUMAN_REQUIRED` + research  
3. Sensitive category (medical/tax/legal) → `HUMAN_REQUIRED` + research  
4. Funding below reserve floor → `HUMAN_REQUIRED`  
5. Else auto-eligible category → `AUTO` (silent)

Routine bills stay quiet. Humans get one researched, speakable brief when a real decision is required.

---

## API surface

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Liveness + mode flags |
| `GET /api/status` | Household, bills, runtime, briefs |
| `POST /api/investigate` | Run full (or targeted) agent investigation |
| `GET/POST /api/brief` | Read or regenerate a decision brief |
| `POST /api/reset` | Clear runtime state |

---

## Product story

Avery and Morgan do not want another noisy finance chatbot. They want Northbridge to:

1. See what is due  
2. Detect anomalies (amount jumps, duplicates, medical)  
3. **Research** what changed in the world (Tavily)  
4. **Reason** with Nemotron into a plain-spoken brief  
5. **Auto-handle** the boring safe bills  
6. Escalate **once**, with a speakable recommendation  

---

## Repo layout

```
app/                Next.js App Router UI + API routes
lib/                Agent, policy, Nemotron, Tavily, fixtures
data/               Pseudonymous household fixtures + offline research
scripts/demo.ts     One-command offline judge path
docs/architecture.md
demo.sh
```

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

---

## Feedback for Nebius / NVIDIA (hackathon ask)

Token Factory’s OpenAI-compatible surface made the live path a one-env-var switch from the offline agent. Dual-model routing (Nano plan / Super brief) is a natural credit-saving pattern we’d love to see as a first-class “agent profile” in the console. Offline-judge demos matter for Devpost judging when keys are scarce — documented fallbacks helped us ship a complete UX either way.
