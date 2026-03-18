import { NextRequest, NextResponse } from "next/server";
import { convertPageWithRetry } from "@/lib/model-gateway";
import { PageChunk } from "@/lib/types";
import { checkRateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60; // Max duration for a single page conversion

export async function POST(req: NextRequest) {
  try {
    // Rate limit: 500 pages per hour per IP
    const ip = getClientId(req);
    const { allowed, resetAt } = checkRateLimit(ip, { limit: 500 });
    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later.", resetAt },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { chunk, previousPageTail } = body as { chunk: PageChunk; previousPageTail?: string };

    if (!chunk || !chunk.base64Data) {
      return NextResponse.json({ error: "Invalid chunk data" }, { status: 400 });
    }

    const startTime = Date.now();
    const convertedPage = await convertPageWithRetry(chunk, { previousPageTail });
    const serverDurationMs = Date.now() - startTime;

    return NextResponse.json({ page: { ...convertedPage, serverDurationMs } });
  } catch (error) {
    console.error("Error converting page:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
