import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { DocumentInitParameters, RenderParameters } from "pdfjs-dist/types/src/display/api";
import { PageChunk } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs-dist/legacy/build/pdf.worker.mjs";

interface PDFMetadata {
  totalPages: number;
  title?: string;
  author?: string;
  isCJK: boolean;
}

const CJK_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/;

const CMAP_URL = pathToFileURL(
  path.join(process.cwd(), "node_modules/pdfjs-dist/cmaps/")
).toString();

const STANDARD_FONT_DATA_URL = pathToFileURL(
  path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/")
).toString();

function cloneToUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0));
}

function createLoadingTask(data: Uint8Array) {
  const params = {
    data,
    disableWorker: true,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  } as unknown as DocumentInitParameters;

  return pdfjsLib.getDocument(params);
}

export async function getPDFMetadata(buffer: ArrayBuffer): Promise<PDFMetadata> {
  const data = cloneToUint8Array(buffer);
  const loadingTask = createLoadingTask(data);
  const doc = await loadingTask.promise;

  try {
    const metadata = await doc.getMetadata().catch(() => ({ info: {} }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = metadata.info as any;

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

    return {
      totalPages: doc.numPages,
      title: info?.Title,
      author: info?.Author,
      isCJK,
    };
  } finally {
    await doc.destroy().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
  }
}

export async function extractPagesAsImages(
  buffer: ArrayBuffer,
  options: { scale?: number; pageRange?: [number, number]; isCJK?: boolean } = {}
): Promise<PageChunk[]> {
  const scale = options.scale || 2.0;
  const data = cloneToUint8Array(buffer);
  const loadingTask = createLoadingTask(data);
  const doc = await loadingTask.promise;

  try {
    const totalPages = doc.numPages;
    const startPage = options.pageRange ? options.pageRange[0] : 1;
    const endPage = options.pageRange ? options.pageRange[1] : totalPages;

    const chunks: PageChunk[] = [];

    for (let i = startPage; i <= endPage; i++) {
      const page = await doc.getPage(i);
      try {
        const viewport = page.getViewport({ scale });

        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));

        const renderParameters: RenderParameters = {
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        };

        await page.render(renderParameters).promise;

        const base64Data = canvas.toBuffer("image/png").toString("base64");

        chunks.push({
          pageNumber: i,
          totalPages,
          base64Data,
          mimeType: "image/png",
          isCJK: options.isCJK,
        });
      } finally {
        page.cleanup();
      }
    }

    return chunks;
  } finally {
    await doc.destroy().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
  }
}

export function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}
