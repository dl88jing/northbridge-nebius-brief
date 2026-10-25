/**
 * Nebius Token Factory list prices (USD per 1M tokens).
 * Source: https://tokenfactory.nebius.com/api/public/models_info, read 2026-10-25.
 * Used only to price token counts that the API actually returned (usage field).
 */
export const PRICES_AS_OF = "2026-10-25";
export const PRICE_SOURCE = "https://tokenfactory.nebius.com/api/public/models_info";

export type Price = { input: number; output: number; label: string };

export const PRICES: Record<string, Price> = {
  "nvidia/nvidia-nemotron-3-nano-30b-a3b": { input: 0.06, output: 0.24, label: "Nemotron 3 Nano 30B-A3B" },
  "nvidia/nemotron-3-super-120b-a12b": { input: 0.3, output: 0.9, label: "Nemotron 3 Super 120B-A12B" },
  "nvidia/nemotron-3-ultra-550b-a55b": { input: 1.0, output: 3.0, label: "Nemotron 3 Ultra 550B-A55B" },
};

export function priceFor(model: string): Price | undefined {
  return PRICES[model.toLowerCase()];
}

/** USD cost for measured token usage; undefined when the model is unpriced. */
export function costUsd(model: string, promptTokens: number, completionTokens: number): number | undefined {
  const p = priceFor(model);
  if (!p) return undefined;
  return (promptTokens * p.input + completionTokens * p.output) / 1_000_000;
}

export function formatUsd(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "n/a";
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}
