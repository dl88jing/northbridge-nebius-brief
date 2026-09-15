import { NextResponse } from "next/server";
import { hasNebiusKey, hasTavilyKey, runtimeMode, getModels } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    product: "Northbridge Brief",
    version: "1.0.0",
    mode: runtimeMode(),
    token_factory: hasNebiusKey(),
    tavily: hasTavilyKey(),
    models: getModels(),
    hackathon: "Nebius x NVIDIA Global AI Hackathon",
  });
}
