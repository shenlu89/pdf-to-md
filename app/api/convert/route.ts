import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientId } from "@/lib/rate-limit";
import { getPDFMetadata, extractPagesAsImages } from "@/lib/pdf-processor";
import { convertPagesConcurrently } from "@/lib/model-gateway";
import { assembleDocument, computeStats } from "@/lib/post-process";
import { StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // 1. Rate Limit
  const ip = getClientId(req);
  const { allowed, resetAt } = checkRateLimit(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded", resetAt },
      { status: 429 }
    );
  }

  // 2. Parse Form Data
  const formData = await req.formData();
  const file = formData.get("file") as File;

  // 3. Validation
  if (!file || file.type !== "application/pdf") {
    return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
  }

  if (file.size > 50 * 1024 * 1024) { // 50MB
    return NextResponse.json({ error: "File size exceeds 50MB" }, { status: 413 });
  }

  // 4. SSE Stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          return;
        }
      };

      const emit = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          safeClose();
        }
      };

      try {
        const buffer = (await file.arrayBuffer()).slice(0);
        const startTime = Date.now();

        // 5a. Metadata
        const metadata = await getPDFMetadata(buffer);

        if (metadata.totalPages > 200) {
          emit({ type: "error", message: "PDF exceeds 200 pages limit" });
          return;
        }

        // 5b. Emit start
        emit({
          type: "start",
          totalPages: metadata.totalPages,
          fileName: file.name,
        });

        // 5c. Extract Pages
        const chunks = await extractPagesAsImages(buffer, {
          scale: 2.0,
          isCJK: metadata.isCJK
        });

        // 5d. Convert Concurrently
        let completed = 0;
        const convertedPages = await convertPagesConcurrently(chunks, {
          concurrency: 4,
          onPageDone: (page) => {
            completed++;
            emit({ type: "page_done", page });
            emit({
              type: "progress",
              completed,
              total: metadata.totalPages,
            });
          },
        });

        // 5e. Assemble
        const markdown = assembleDocument(convertedPages);
        const stats = computeStats(convertedPages, startTime);

        // 5f. Emit done
        emit({ type: "done", markdown, stats });
      } catch (error) {
        console.error("Conversion error:", error);
        emit({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        safeClose();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
