import { loadPolicy } from "./fixtures";

/** Key presence checks never return or log the key value. */
export function getNebiusKey(): string | undefined {
  return (
    process.env.NEBIUS_API_KEY ||
    process.env.NEBIUS_TOKEN_FACTORY_API_KEY ||
    process.env.TOKEN_FACTORY_API_KEY ||
    undefined
  );
}

export function hasNebiusKey(): boolean {
  return Boolean(getNebiusKey());
}

export function getTavilyKey(): string | undefined {
  return process.env.TAVILY_API_KEY || undefined;
}

export function hasTavilyKey(): boolean {
  return Boolean(getTavilyKey());
}

export function getModels() {
  const p = loadPolicy().nemotron;
  return {
    fast: process.env.NEMOTRON_FAST_MODEL || p.fast_model,
    reason: process.env.NEMOTRON_REASON_MODEL || p.reason_model,
    ultra: process.env.NEMOTRON_ULTRA_MODEL || p.ultra_model,
    baseUrl: process.env.NEBIUS_BASE_URL || p.base_url,
    altBaseUrl: p.alt_base_url,
  };
}

/**
 * live     = Token Factory and Tavily keys both present
 * partial  = only one of them present
 * offline  = neither; UI shows a clear OFFLINE DEMO banner
 */
export function runtimeMode(): "live" | "partial" | "offline" {
  const n = hasNebiusKey();
  const t = hasTavilyKey();
  if (n && t) return "live";
  if (n || t) return "partial";
  return "offline";
}
