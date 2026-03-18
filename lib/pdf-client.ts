import { PageChunk } from "./types";

let pdfjsLib: any = null;

// Only initialize if we're in the browser
// We use lazy loading inside the function to avoid SSR issues and reduce initial bundle size.


interface PDFMetadata {
  totalPages: number;
  isCJK: boolean;
}

const CJK_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/;

export async function extractPDFPagesFromClient(
  file: File,
  scale: number = 1.5,
  onProgress?: (progress: number, total: number) => void
): Promise<{ metadata: PDFMetadata; chunks: PageChunk[] }> {
  // Ensure pdfjsLib is loaded
  if (!pdfjsLib) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    pdfjsLib = await import("pdfjs-dist/build/pdf.min.mjs");
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    }
  }

  const arrayBuffer = await file.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const doc = await loadingTask.promise;

  // 1. Detect CJK by sampling the first few pages
  let cjkCount = 0;
  let totalChars = 0;
  const numPagesToCheck = Math.min(3, doc.numPages);

  for (let i = 1; i <= numPagesToCheck; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = content.items.map((item: any) => item.str).join("");

    for (const char of text) {
      totalChars++;
      if (CJK_REGEX.test(char)) {
        cjkCount++;
      }
    }
  }
  const isCJK = totalChars > 0 && cjkCount / totalChars > 0.15;
  const totalPages = doc.numPages;

  const chunks: PageChunk[] = [];

  // 2. Render each page
  for (let i = 1; i <= totalPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not create canvas context");

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvasContext: context,
      canvas: canvas,
      viewport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise;

    // Convert canvas to JPEG Base64
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    // Strip the "data:image/jpeg;base64," prefix
    const base64Data = dataUrl.split(",")[1];

    chunks.push({
      pageNumber: i,
      totalPages,
      base64Data,
      mimeType: "image/jpeg",
      isCJK,
    });

    if (onProgress) {
      onProgress(i, totalPages);
    }
  }

  return {
    metadata: { totalPages, isCJK },
    chunks,
  };
}
