"use client";

import React, { useState, useRef } from "react";
import DropZone from "@/components/DropZone";
import ConversionProgress from "@/components/ConversionProgress";
import MarkdownPreview from "@/components/MarkdownPreview";
import { ConvertedPage, ConversionStats } from "@/lib/types";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { assembleDocument, computeStats } from "@/lib/post-process";

type Phase = "idle" | "uploading" | "processing" | "done" | "error";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");
  const [totalPages, setTotalPages] = useState(0);
  const [completedPages, setCompletedPages] = useState(0);
  const [pages, setPages] = useState<ConvertedPage[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [stats, setStats] = useState<ConversionStats | undefined>();
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFile = async (file: File) => {
    // Reset state
    setPhase("processing");
    setFileName(file.name);
    setTotalPages(0);
    setCompletedPages(0);
    setPages([]);
    setMarkdown("");
    setStats(undefined);
    setError(null);

    // Abort previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const startTime = Date.now();

      // 1. Extract pages on the client
      // Dynamic import to avoid SSR issues with pdfjs-dist
      const { extractPDFPagesFromClient } = await import("@/lib/pdf-client");
      const { metadata, chunks } = await extractPDFPagesFromClient(file, 1.5, (completed: number, total: number) => {
        // Optionally show progress of local rendering here
        setTotalPages(total);
      });

      if (metadata.totalPages > 200) {
        throw new Error("PDF exceeds 200 pages limit");
      }

      setTotalPages(metadata.totalPages);

      // 2. Setup concurrency queue
      const concurrency = 4;
      const results: ConvertedPage[] = new Array(chunks.length);
      let index = 0;
      let completedCount = 0;

      async function worker() {
        while (index < chunks.length) {
          if (controller.signal.aborted) break;

          const i = index++;
          const chunk = chunks[i];
          const previousPageTail = i > 0
            ? results[i - 1]?.markdown?.split("\n").filter(Boolean).slice(-3).join("\n")
            : undefined;

          try {
            const response = await fetch("/api/convert-page", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chunk, previousPageTail }),
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error(`Failed to convert page ${chunk.pageNumber}`);
            }

            const data = await response.json();
            results[i] = data.page;

            // Update state
            setPages((prev) => [...prev, data.page]);
            completedCount++;
            setCompletedPages(completedCount);

          } catch (err: unknown) {
            if (err instanceof Error && err.name === "AbortError") return;
            console.error(err);
            // Fallback for failed page
            results[i] = {
              pageNumber: chunk.pageNumber,
              markdown: "<!-- conversion error -->",
              hasTables: false,
              hasMath: false,
              hasCode: false,
              confidence: 0,
              modelUsed: "gemini-2.0-flash",
            };
            completedCount++;
            setCompletedPages(completedCount);
          }
        }
      }

      // Run workers
      await Promise.all(Array.from({ length: concurrency }, worker));

      if (controller.signal.aborted) return;

      // 3. Assemble and calculate stats locally
      const validResults = results.filter(Boolean);
      const finalMarkdown = assembleDocument(validResults);
      const finalStats = computeStats(validResults, startTime);

      setMarkdown(finalMarkdown);
      setStats(finalStats);
      setPhase("done");

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("Request aborted");
        return;
      }
      console.error("Conversion error:", err);
      setError(err instanceof Error ? err.message : "Unknown error occurred");
      setPhase("error");
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setPhase("idle");
  };

  const handleReset = () => {
    setPhase("idle");
    setFileName("");
    setPages([]);
    setMarkdown("");
    setError(null);
  };

  // Compute live markdown for preview during processing
  const liveMarkdown = React.useMemo(() => {
    if (phase === "done") return markdown;
    // Sort pages and join
    return pages
      .sort((a, b) => a.pageNumber - b.pageNumber)
      .map(p => p.markdown)
      .join("\n\n---\n\n");
  }, [pages, markdown, phase]);

  return (
    <div className="page">
      <header className="page-header">
        <div className="logo">
          <div className="logo-mark">MD</div>
          <span className="logo-arrow">→</span>
          <span className="tagline">PDF to Markdown</span>
        </div>
      </header>

      <main className="workspace">
        {/* Left Column: Input / Progress */}
        <section className="column left">
          {phase === "idle" || phase === "error" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <DropZone onFile={handleFile} />
              {phase === "error" && error && (
                <div style={{
                  background: "rgba(255, 90, 90, 0.1)",
                  border: "1px solid var(--accent-red)",
                  borderRadius: "var(--radius-md)",
                  padding: "1rem",
                  color: "var(--accent-red)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem"
                }}>
                  <AlertTriangle size={20} />
                  <span>{error}</span>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <ConversionProgress
                fileName={fileName}
                completed={completedPages}
                total={totalPages || 1}
                pages={pages}
                stats={stats}
              />

              {phase !== "done" && (
                <button className="action-btn" onClick={handleCancel} style={{ alignSelf: "center" }}>
                  Cancel
                </button>
              )}

              {phase === "done" && (
                <button className="action-btn primary" onClick={handleReset} style={{ width: "100%", justifyContent: "center" }}>
                  <RotateCcw size={16} />
                  Convert another file
                </button>
              )}
            </div>
          )}
        </section>

        {/* Right Column: Preview */}
        <section className="column right">
          {phase === "idle" ? (
            <div style={{
              height: "100%",
              border: "2px dashed var(--border)",
              borderRadius: "var(--radius-lg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-muted)"
            }}>
              Preview will appear here
            </div>
          ) : (
            <MarkdownPreview markdown={liveMarkdown} fileName={fileName} />
          )}
        </section>
      </main>
    </div>
  );
}
