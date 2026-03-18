import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { ConvertedPage, ModelId, PageChunk } from "./types";
import { buildUserPrompt, buildRetryPrompt, SYSTEM_PROMPT } from "./prompts";

// Enable global proxy if set in environment (useful for Google APIs in China)
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  const dispatcher = new ProxyAgent(proxyUrl);
  setGlobalDispatcher(dispatcher);
}

// Google AI (Gemini)
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_AI_API_KEY!,
  baseURL: process.env.VERCEL_AI_GATEWAY_URL
    ? `${process.env.VERCEL_AI_GATEWAY_URL}/google`
    : undefined,
});

// Aliyun DashScope (Qwen VL) — OpenAI compatible
const dashscope = createOpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

const PageOutputSchema = z.object({
  markdown: z.string().describe("Raw Markdown content, no wrapping fences"),
  hasTables: z.boolean(),
  hasMath: z.boolean(),
  hasCode: z.boolean(),
  confidence: z.number().describe(
    "Conversion quality confidence score between 0.0 and 1.0. Be honest: table/math errors = lower score."
  ),
  detectedLanguage: z.string().describe("e.g. 'en', 'zh', 'ja'"),
});

const MODEL_API_NAMES: Record<ModelId, string> = {
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.0-flash": "gemini-2.0-flash",
  "qwen-vl-max": "qwen-vl-max",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function selectModel(chunk: PageChunk, forceModel?: ModelId): { modelId: ModelId; model: any } {
  if (forceModel) {
    const modelId = forceModel;
    const provider = modelId.startsWith("qwen") ? dashscope : google;
    return { modelId, model: provider(MODEL_API_NAMES[modelId]) };
  }

  if (chunk.isCJK) {
    return { modelId: "qwen-vl-max", model: dashscope(MODEL_API_NAMES["qwen-vl-max"]) };
  }

  return { modelId: "gemini-2.0-flash", model: google(MODEL_API_NAMES["gemini-2.0-flash"]) };
}

function buildImagePart(chunk: PageChunk) {
  if (!chunk.base64Data) {
    throw new Error(`Missing image data for page ${chunk.pageNumber}`);
  }

  return {
    type: "image" as const,
    image: Buffer.from(chunk.base64Data, "base64"),
    mimeType: chunk.mimeType,
  };
}

async function convertPage(
  chunk: PageChunk,
  options: { previousPageTail?: string; forceModel?: ModelId } = {}
): Promise<ConvertedPage> {
  const { modelId, model } = selectModel(chunk, options.forceModel);
  const prompt = buildUserPrompt(chunk.pageNumber, chunk.totalPages, options.previousPageTail);

  const result = await generateObject({
    model,
    schema: PageOutputSchema,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          buildImagePart(chunk),
        ],
      },
    ],
    maxOutputTokens: 8192,
    temperature: 0.1,
  });

  const output = result.object;

  let normalizedConfidence = output.confidence;
  if (normalizedConfidence > 1) {
    // If model outputs a 1-10 or 1-100 score, normalize it to 0-1
    normalizedConfidence = normalizedConfidence <= 10 ? normalizedConfidence / 10 : normalizedConfidence / 100;
  }

  return {
    pageNumber: chunk.pageNumber,
    markdown: output.markdown,
    hasTables: output.hasTables,
    hasMath: output.hasMath,
    hasCode: output.hasCode,
    confidence: normalizedConfidence,
    modelUsed: modelId,
    tokensUsed: result.usage.totalTokens,
  };
}

function validatePage(page: ConvertedPage): string[] {
  const issues: string[] = [];

  // 1. Broken tables
  const lines = page.markdown.split("\n");
  const tableLines = lines.filter(l => l.trim().startsWith("|") && l.trim().endsWith("|"));
  if (tableLines.length > 0) {
    const pipeCounts = tableLines.map(l => (l.match(/\|/g) || []).length);
    // Simple heuristic: most common pipe count
    const counts: Record<number, number> = {};
    pipeCounts.forEach(c => counts[c] = (counts[c] || 0) + 1);
    const sortedCounts = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const mode = parseInt(sortedCounts[0][0]);

    const invalidCount = pipeCounts.filter(c => c !== mode).length;
    if (invalidCount / tableLines.length > 0.1) {
      issues.push("Inconsistent table columns");
    }
  }

  // 2. Model preamble
  const PREAMBLE_PATTERNS = [/^here is/i, /^sure/i, /^of course/i];
  if (PREAMBLE_PATTERNS.some(p => p.test(page.markdown.trim()))) {
    issues.push("Contains model preamble");
  }

  // 3. Output truncation
  if (page.markdown.length < 50 && !page.markdown.includes("<!-- blank page -->")) {
    issues.push("Output too short");
  }

  // 4. Empty output
  if (!page.markdown.trim()) {
    issues.push("Empty output");
  }

  return issues;
}

export async function convertPageWithRetry(
  chunk: PageChunk,
  options: { previousPageTail?: string } = {}
): Promise<ConvertedPage> {
  let result = await convertPage(chunk, options);

  const issues = validatePage(result);
  const shouldRetry = result.confidence < 0.72 || issues.length > 0;

  if (shouldRetry && !result.retried) {
    console.log(`Retrying page ${chunk.pageNumber} due to: ${issues.join(", ") || "low confidence"}`);

    const { model } = selectModel(chunk, "gemini-2.5-pro");
    const prompt = buildRetryPrompt(chunk.pageNumber, issues.join("; "));

    try {
      const retryResult = await generateObject({
        model,
        schema: PageOutputSchema,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              buildImagePart(chunk),
            ],
          },
        ],
        maxOutputTokens: 8192,
        temperature: 0.1,
      });

      const output = retryResult.object;

      let normalizedConfidence = output.confidence;
      if (normalizedConfidence > 1) {
        normalizedConfidence = normalizedConfidence <= 10 ? normalizedConfidence / 10 : normalizedConfidence / 100;
      }

      result = {
        ...result,
        markdown: output.markdown,
        hasTables: output.hasTables,
        hasMath: output.hasMath,
        hasCode: output.hasCode,
        confidence: normalizedConfidence,
        modelUsed: "gemini-2.5-pro",
        tokensUsed: (result.tokensUsed || 0) + (retryResult.usage.totalTokens || 0),
        retried: true,
      };
    } catch (error) {
      console.error(`Retry failed for page ${chunk.pageNumber}`, error);
    }
  }

  return result;
}

export async function convertPagesConcurrently(
  chunks: PageChunk[],
  options: {
    concurrency?: number;
    onPageDone?: (page: ConvertedPage) => void;
  } = {}
): Promise<ConvertedPage[]> {
  const concurrency = options.concurrency || 4;
  const results: ConvertedPage[] = new Array(chunks.length);
  let index = 0;

  async function worker() {
    while (index < chunks.length) {
      const i = index++;
      if (i >= chunks.length) break;

      const chunk = chunks[i];
      const previousPageTail = i > 0
        ? results[i - 1]?.markdown?.split("\n").filter(Boolean).slice(-3).join("\n")
        : undefined;

      try {
        results[i] = await convertPageWithRetry(chunk, { previousPageTail });
      } catch (e) {
        console.error(`Error converting page ${chunk.pageNumber}`, e);
        results[i] = {
          pageNumber: chunk.pageNumber,
          markdown: "<!-- conversion error -->",
          hasTables: false,
          hasMath: false,
          hasCode: false,
          confidence: 0,
          modelUsed: "gemini-2.5-pro",
          retried: false
        };
      }

      options.onPageDone?.(results[i]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
