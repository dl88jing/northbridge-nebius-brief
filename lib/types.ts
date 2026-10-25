export type Decision = "AUTO" | "HUMAN_REQUIRED";

export type Bill = {
  id: string;
  payee: string;
  category: string;
  amount: number;
  currency: string;
  due_date: string;
  status: string;
  autopay: boolean;
  account_last4: string;
  expected_amount_range: [number, number];
  funding_account_id: string;
  notes: string;
};

export type FundingAccount = {
  id: string;
  name: string;
  institution: string;
  available_balance: number;
  reserve_floor: number;
  currency: string;
};

export type CalendarDue = {
  id: string;
  kind: string;
  title: string;
  ref_id: string;
  due_date: string;
  priority: string;
};

export type ResearchHit = {
  title: string;
  url: string;
  snippet: string;
  /** Passage pulled by Tavily /extract (query-reranked chunks), when available. */
  extract?: string;
  score?: number;
};

export type ResearchBundle = {
  query: string;
  source: "tavily" | "offline_fixture" | "none";
  results: ResearchHit[];
  /** Tavily credits reported by the API (include_usage); undefined offline. */
  credits?: number;
  search_ms?: number;
  extract_ms?: number;
  extracted_count?: number;
  error?: string;
};

export type LlmUsage = {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  cost_usd?: number;
  /** true only when the API returned a usage block. */
  measured: boolean;
};

export type UltraReview = {
  verdict: "confirm" | "revise";
  unsupported_claims: string[];
  final_recommendation: string;
  reason: string;
  model: string;
};

export type CostReceipt = {
  measured: boolean;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  routed_cost_usd: number;
  /** Same measured tokens priced at the Ultra list rate (not a separate run). */
  all_ultra_repriced_usd: number;
  savings_pct: number;
  tavily_credits: number;
  per_model: { model: string; calls: number; prompt_tokens: number; completion_tokens: number; cost_usd: number }[];
  prices_as_of: string;
  price_source: string;
};

export type AgentStep = {
  id: string;
  ts: string;
  kind: "plan" | "tool" | "policy" | "research" | "llm" | "brief" | "action";
  title: string;
  detail?: string;
  data?: unknown;
  model?: string;
  usage?: LlmUsage;
  ms?: number;
};

export type InvestigationResult = {
  bill_id: string;
  payee: string;
  decision: Decision;
  reasons: string[];
  funding_ok: boolean;
  research?: ResearchBundle;
  brief?: DecisionBrief;
  steps: AgentStep[];
  action: "auto_handled" | "escalated";
};

export type DecisionBrief = {
  bill_id: string;
  headline: string;
  situation: string;
  why_it_matters: string;
  recommended_action: string;
  questions_for_humans: string[];
  research_summary?: string;
  speakable: string;
  model_used: string;
  mode: "live" | "offline";
  /** Numbered sources the brief cites as [1], [2] ... */
  citations?: { n: number; title: string; url: string }[];
  ultra_review?: UltraReview;
};

export type InvestigateResponse = {
  ok: true;
  mode: "live" | "partial" | "offline";
  models: { fast: string; reason: string; ultra: string };
  receipt: CostReceipt;
  started_at: string;
  duration_ms: number;
  token_factory: boolean;
  tavily: boolean;
  household: string;
  summary: {
    auto: number;
    escalated: number;
    investigated: number;
  };
  results: InvestigationResult[];
  timeline: AgentStep[];
};

export type RuntimeState = {
  handled: string[];
  needs_decision: string[];
  briefs: Record<string, DecisionBrief>;
  last_run?: InvestigateResponse;
};
