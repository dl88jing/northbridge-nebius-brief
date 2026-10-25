import OpenAI from "openai";
import { getNebiusKey, getModels } from "./config";
import { costUsd } from "./pricing";
import type { LlmUsage } from "./types";

export type ChatMessage = { role: "system" | "user"; content: string };

/** Minimal surface we need from an OpenAI-compatible client (injectable for tests). */
export type ChatClient = {
  chat: {
    completions: {
      create: (args: {
        model: string;
        temperature?: number;
        max_tokens?: number;
        messages: ChatMessage[];
      }) => Promise<{
        choices: { message?: { content?: string | null } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
      }>;
    };
  };
};

let injected: ChatClient | null = null;
/** Test hook: route all LLM calls to a fake client. Pass null to restore. */
export function setChatClient(c: ChatClient | null) {
  injected = c;
}

function clientFor(baseURL: string): ChatClient {
  if (injected) return injected;
  return new OpenAI({ apiKey: getNebiusKey(), baseURL, timeout: 45_000, maxRetries: 1 }) as unknown as ChatClient;
}

export type ChatResult = { text: string; usage: LlmUsage };

/**
 * One Token Factory chat call with measured latency + token usage.
 * Tries the configured base URL first, then the alternate public endpoint.
 */
export async function chat(model: string, messages: ChatMessage[], opts?: { temperature?: number; max_tokens?: number }): Promise<ChatResult> {
  const { baseUrl, altBaseUrl } = getModels();
  const urls = injected ? [baseUrl] : Array.from(new Set([baseUrl, altBaseUrl]));
  let lastErr: unknown;
  for (const url of urls) {
    const t0 = Date.now();
    try {
      const resp = await clientFor(url).chat.completions.create({
        model,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.max_tokens ?? 1200,
        messages,
      });
      const latency_ms = Date.now() - t0;
      const prompt_tokens = resp.usage?.prompt_tokens ?? 0;
      const completion_tokens = resp.usage?.completion_tokens ?? 0;
      return {
        text: resp.choices[0]?.message?.content || "",
        usage: {
          model,
          prompt_tokens,
          completion_tokens,
          latency_ms,
          cost_usd: costUsd(model, prompt_tokens, completion_tokens),
          measured: Boolean(resp.usage),
        },
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Token Factory call failed");
}

/** Pull the first JSON object out of a model reply (handles ```json fences and reasoning preambles). */
export function extractJson<T = Record<string, unknown>>(text: string): T | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
