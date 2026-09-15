# Northbridge Brief — Architecture

## Overview

Northbridge Brief is a Next.js application with serverless API routes that orchestrate an **investigation agent**. The agent combines:

1. **Deterministic household tools** (fixtures under `data/`)
2. **Quiet policy gate** (`lib/policy.ts`) — AUTO vs HUMAN_REQUIRED
3. **Tavily web research** (`lib/tavily.ts`) — live or offline fixtures
4. **NVIDIA Nemotron via Nebius Token Factory** (`lib/nemotron.ts`) — plan + briefs

```
┌─────────────────────────────────────────────────────────┐
│  Control Plane Dashboard (app/page.tsx)                 │
│  timeline · ledger · speakable briefs                   │
└───────────────────────────┬─────────────────────────────┘
                            │ fetch /api/*
┌───────────────────────────▼─────────────────────────────┐
│  API routes (Vercel serverless)                         │
│  /investigate /status /brief /health /reset             │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  lib/agent.ts — investigation loop                      │
│    1. planInvestigation()     → Nemotron Nano           │
│    2. list / parse bills      → fixtures                │
│    3. evaluateBill()          → policy gate             │
│    4. researchWeb()           → Tavily / fixtures       │
│    5. composeDecisionBrief()  → Nemotron Super          │
│    6. auto-handle OR escalate → runtime state           │
└─────────────────────────────────────────────────────────┘
```

## Offline vs live

| Capability | Offline (default) | Live |
|------------|-------------------|------|
| Policy gate | Full | Full |
| Research | `data/offline_research.json` | Tavily API |
| Plan + briefs | Deterministic Nemotron-shaped synthesis | Token Factory chat completions |
| Dashboard UX | Full | Full |

Live mode activates when `NEBIUS_API_KEY` is present. Failures fall back to offline briefs so the product never hard-crashes for judges.

## Pseudonyms

Household members are **Avery Quinn** and **Morgan Quinn**. Product name is **Northbridge**. No real personal data is included.
