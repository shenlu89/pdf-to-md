import React, { useState } from "react";
import { Copy, Download, FileCode, Eye } from "lucide-react";

interface MarkdownPreviewProps {
  markdown: string;
  fileName: string;
}

export default function MarkdownPreview({ markdown, fileName }: MarkdownPreviewProps) {
  const [mode, setMode] = useState<"preview" | "raw">("preview");
  const [copied, setCopied] = useState(false);

  const lines = markdown.split("\n").length;
  const chars = markdown.length;

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(".pdf", ".md");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderMarkdown = (md: string) => {
    let html = md
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => 
      `<pre><code class="lang-${lang || 'text'}">${code}</code></pre>`
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Headers
    html = html.replace(/^### (.*$)/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gm, "<h1>$1</h1>");

    // Bold/Italic
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

    // Blockquote
    html = html.replace(/^> (.*$)/gm, "<blockquote>$1</blockquote>");

    // HR
    html = html.replace(/^---$/gm, "<hr>");

    // Lists
    html = html.replace(/^[-*+] (.*$)/gm, "<li>$1</li>");
    html = html.replace(/^\d+\. (.*$)/gm, "<li>$1</li>");

    // Paragraphs (double newline)
    html = html.replace(/\n\n/g, "</p><p>");
    
    return { __html: html };
  };

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div className="meta-pill" style={{ 
              background: "var(--surface-2)", 
              padding: "2px 8px", 
              borderRadius: "4px", 
              fontSize: "0.75rem", 
              color: "var(--text-secondary)" 
          }}>
            {lines} lines · {chars} chars
          </div>
          
          <div style={{ display: "flex", background: "var(--surface-2)", borderRadius: "6px", padding: "2px" }}>
            <button
              className={`toggle-btn ${mode === "preview" ? "active" : ""}`}
              onClick={() => setMode("preview")}
              title="Preview"
            >
              <Eye size={16} />
            </button>
            <button
              className={`toggle-btn ${mode === "raw" ? "active" : ""}`}
              onClick={() => setMode("raw")}
              title="Raw Markdown"
            >
              <FileCode size={16} />
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="action-btn" onClick={handleCopy} title="Copy to clipboard">
            <Copy size={16} />
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="action-btn primary" onClick={handleDownload} title="Download .md">
            <Download size={16} />
            Download
          </button>
        </div>
      </div>

      <div className="preview-content" style={{ flex: 1, overflow: "auto", padding: "1.5rem" }}>
        {mode === "raw" ? (
          <pre className="markdown-raw" style={{ 
              fontFamily: "var(--font-mono)", 
              fontSize: "0.875rem", 
              whiteSpace: "pre-wrap", 
              color: "var(--text-primary)" 
          }}>
            {markdown}
          </pre>
        ) : (
          <div 
            className="markdown-preview"
            dangerouslySetInnerHTML={renderMarkdown(markdown)}
          />
        )}
      </div>
    </div>
  );
}
