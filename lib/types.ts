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
};

export type ResearchBundle = {
  query: string;
  source: "tavily" | "offline_fixture" | "none";
  results: ResearchHit[];
};

export type AgentStep = {
  id: string;
  ts: string;
  kind: "plan" | "tool" | "policy" | "research" | "llm" | "brief" | "action";
  title: string;
  detail?: string;
  data?: unknown;
  model?: string;
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
};

export type InvestigateResponse = {
  ok: true;
  mode: "live" | "offline";
  models: { fast: string; reason: string };
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
