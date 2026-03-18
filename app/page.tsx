"use client";

import React, { useState, useRef } from "react";
import DropZone from "@/components/DropZone";
import ConversionProgress from "@/components/ConversionProgress";
import MarkdownPreview from "@/components/MarkdownPreview";
import { ConvertedPage, ConversionStats, StreamEvent } from "@/lib/types";
import { AlertTriangle, RotateCcw } from "lucide-react";

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
    setPhase("uploading");
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
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/convert", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      setPhase("processing");

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep last partial line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event: StreamEvent = JSON.parse(raw);

            switch (event.type) {
              case "start":
                setTotalPages(event.totalPages);
                break;
              case "page_done":
                setPages((prev) => [...prev, event.page]);
                break;
              case "progress":
                setCompletedPages(event.completed);
                break;
              case "done":
                setMarkdown(event.markdown);
                setStats(event.stats);
                setPhase("done");
                break;
              case "error":
                streamError = event.message;
                break;
            }
          } catch (e) {
            streamError = e instanceof Error ? e.message : "Error parsing server event";
          }

          if (streamError) break;
        }

        if (streamError) break;
      }

      if (streamError) {
        await reader.cancel();
        setError(streamError);
        setPhase("error");
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        console.log("Request aborted");
        return;
      }
      console.error("Upload error:", err);
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
