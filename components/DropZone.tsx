import React, { useCallback, useState } from "react";
import { Upload, AlertCircle } from "lucide-react";

interface DropZoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export default function DropZone({ onFile, disabled }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateAndUpload = useCallback((file: File | undefined) => {
    if (!file) return;

    if (file.type !== "application/pdf") {
      setError("Only PDF files are supported");
      setTimeout(() => setError(null), 3000);
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      setError("File size exceeds 50MB");
      setTimeout(() => setError(null), 3000);
      return;
    }

    onFile(file);
  }, [onFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const file = e.dataTransfer.files[0];
    validateAndUpload(file);
  }, [disabled, validateAndUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || !e.target.files?.length) return;
    const file = e.target.files[0];
    validateAndUpload(file);
    e.target.value = "";
  }, [disabled, validateAndUpload]);

  return (
    <div
      className={`dropzone ${isDragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && document.getElementById("file-input")?.click()}
    >
      <input
        id="file-input"
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleFileSelect}
        disabled={disabled}
        style={{ display: "none" }}
      />

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
        <div style={{ color: error ? "var(--accent-red)" : "var(--accent-blue)" }}>
          {error ? <AlertCircle size={48} /> : <Upload size={48} />}
        </div>

        {error ? (
          <p style={{ color: "var(--accent-red)" }}>{error}</p>
        ) : (
          <div style={{ textAlign: "center" }}>
            <h3 style={{ fontSize: "1.25rem", marginBottom: "0.5rem", color: "var(--text-primary)" }}>
              {isDragging ? "Drop PDF here" : "Drag & drop PDF here"}
            </h3>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              or click to browse (max 50MB)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
