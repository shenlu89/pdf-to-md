import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pdfPath = process.argv[2];

if (!pdfPath) {
  throw new Error("Usage: node scripts/pdfjs-smoke.mjs /path/to/file.pdf");
}

const data = new Uint8Array(await readFile(pdfPath));
const cMapUrl = pathToFileURL(
  path.join(process.cwd(), "node_modules/pdfjs-dist/cmaps/")
).toString();
const standardFontDataUrl = pathToFileURL(
  path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/")
).toString();

const loadingTask = pdfjsLib.getDocument({
  data,
  cMapUrl,
  cMapPacked: true,
  standardFontDataUrl,
});
const doc = await loadingTask.promise;

try {
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvas, viewport }).promise;
  const buf = canvas.toBuffer("image/png");
  process.stdout.write(
    JSON.stringify({ ok: true, pages: doc.numPages, pngBytes: buf.length }) + "\n"
  );
} finally {
  await doc.destroy().catch(() => undefined);
  await loadingTask.destroy().catch(() => undefined);
}
