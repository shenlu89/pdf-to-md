import React from "react";
import { ConvertedPage, ConversionStats } from "@/lib/types";

interface ConversionProgressProps {
  fileName: string;
  completed: number;
  total: number;
  pages: ConvertedPage[];
  stats?: ConversionStats;
}

export default function ConversionProgress({
  fileName,
  completed,
  total,
  pages,
  stats,
}: ConversionProgressProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  // Calculate running stats if final stats not available
  const avgConfidence = pages.length > 0
    ? pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length
    : 0;
  const retriedCount = stats ? stats.retriedPages : pages.filter(p => p.retried).length;
  const tokenCount = stats 
    ? stats.totalTokens 
    : pages.reduce((sum, p) => sum + (p.tokensUsed || 0), 0);
  
  const duration = stats ? (stats.durationMs / 1000).toFixed(1) + "s" : "--";

  const getModelColor = (modelId: string) => {
    switch (modelId) {
      case "gemini-2.5-pro": return "var(--accent-blue)";
      case "gemini-2.0-flash": return "var(--accent-teal)";
      case "qwen-vl-max": return "var(--accent-amber)";
      default: return "var(--text-muted)";
    }
  };

  return (
    <div className="progress-panel">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{fileName}</span>
        <span style={{ color: "var(--text-secondary)" }}>{completed} / {total} pages</span>
      </div>
      
      <div className="progress-track">
        <div 
          className="progress-fill" 
          style={{ width: `${percentage}%` }}
        />
      </div>
      
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "repeat(4, 1fr)", 
        gap: "1rem",
        marginTop: "1rem",
        fontSize: "0.875rem",
        color: "var(--text-secondary)"
      }}>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Quality</div>
          <div style={{ color: "var(--text-primary)" }}>{(avgConfidence * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Tokens</div>
          <div style={{ color: "var(--text-primary)" }}>{(tokenCount / 1000).toFixed(1)}k</div>
        </div>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Retries</div>
          <div style={{ color: "var(--text-primary)" }}>{retriedCount}</div>
        </div>
        <div>
          <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Time</div>
          <div style={{ color: "var(--text-primary)" }}>{duration}</div>
        </div>
      </div>
      
      {total <= 60 && (
        <div className="page-dots" style={{ marginTop: "1.5rem" }}>
          {Array.from({ length: total }).map((_, i) => {
            const page = pages.find(p => p.pageNumber === i + 1);
            
            let backgroundColor = "var(--surface-3)";
            let opacity = 1;
            
            if (page) {
                backgroundColor = getModelColor(page.modelUsed);
                opacity = 0.4 + page.confidence * 0.6;
            }
            
            return (
              <div 
                key={i} 
                className="page-dot"
                style={{ 
                    backgroundColor, 
                    opacity,
                    transition: "all 0.3s ease"
                }}
                title={page ? `Page ${i+1}: ${page.modelUsed} (${(page.confidence * 100).toFixed(0)}%)` : `Page ${i+1}`}
              />
            );
          })}
        </div>
      )}
      
      {stats && (
          <div style={{ display: "flex", gap: "1rem", marginTop: "1rem", fontSize: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-blue)" }}></div>
                  <span style={{ color: "var(--text-muted)" }}>Gemini 2.5 Pro</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent-amber)" }}></div>
                  <span style={{ color: "var(--text-muted)" }}>Qwen VL Max</span>
              </div>
          </div>
      )}
    </div>
  );
}
