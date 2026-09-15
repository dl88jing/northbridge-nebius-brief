import { loadPolicy } from "./fixtures";

/** Discover keys from env / common local config paths without printing secrets. */
export function hasNebiusKey(): boolean {
  return Boolean(
    process.env.NEBIUS_API_KEY ||
      process.env.NEBIUS_TOKEN_FACTORY_API_KEY ||
      process.env.TOKEN_FACTORY_API_KEY
  );
}

export function getNebiusKey(): string | undefined {
  return (
    process.env.NEBIUS_API_KEY ||
    process.env.NEBIUS_TOKEN_FACTORY_API_KEY ||
    process.env.TOKEN_FACTORY_API_KEY
  );
}

export function hasTavilyKey(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export function getTavilyKey(): string | undefined {
  return process.env.TAVILY_API_KEY;
}

export function getModels() {
  const p = loadPolicy().nemotron;
  return {
    fast: process.env.NEMOTRON_FAST_MODEL || p.fast_model,
    reason: process.env.NEMOTRON_REASON_MODEL || p.reason_model,
    baseUrl:
      process.env.NEBIUS_BASE_URL ||
      p.base_url ||
      "https://api.tokenfactory.nebius.com/v1/",
  };
}

export function runtimeMode(): "live" | "offline" {
  return hasNebiusKey() ? "live" : "offline";
}
