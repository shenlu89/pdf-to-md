import { ConvertedPage, ConversionStats, ModelId } from "./types";

export function assembleDocument(pages: ConvertedPage[]): string {
    // 1. Sort by page number
    const sortedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

    // 2. Filter blank pages and empty strings
    let markdowns = sortedPages
        .map(p => p.markdown)
        .filter(md => md.trim() !== "" && !md.includes("<!-- blank page -->"));

    // 3. mergeFragmentedTables
    markdowns = mergeFragmentedTables(markdowns);

    // 4. mergeFragmentedLists
    markdowns = mergeFragmentedLists(markdowns);

    // 5. removeDuplicateHeadings
    markdowns = removeDuplicateHeadings(markdowns);

    // 6. stripModelPreambles
    markdowns = stripModelPreambles(markdowns);

    // 7. Join
    const assembled = markdowns.join("\n\n---\n\n");

    // 8. Normalize
    return normalizeWhitespace(assembled);
}

function mergeFragmentedTables(pages: string[]): string[] {
    const result: string[] = [];
    let skipNext = false;

    for (let i = 0; i < pages.length; i++) {
        if (skipNext) {
            skipNext = false;
            continue;
        }

        const current = pages[i];
        if (i === pages.length - 1) {
            result.push(current);
            continue;
        }

        const next = pages[i + 1];

        const currentLines = current.trimEnd().split("\n");
        const nextLines = next.trimStart().split("\n");

        const lastNonEmpty = currentLines.filter(l => l.trim()).pop();
        const nextNonEmptyLines = nextLines.filter(l => l.trim());
        const firstNonEmpty = nextNonEmptyLines[0];

        if (lastNonEmpty?.trim().startsWith("|") && firstNonEmpty?.trim().startsWith("|")) {
            // Check next page separator
            const first5PipeLines = nextNonEmptyLines
                .filter(l => l.trim().startsWith("|"))
                .slice(0, 5);

            const hasSeparator = first5PipeLines.some(l => /\|\s*[-:]+\s*\|/.test(l));

            if (!hasSeparator) {
                result.push(current + "\n" + next);
                skipNext = true;
                continue;
            }
        }

        result.push(current);
    }
    return result;
}

function mergeFragmentedLists(pages: string[]): string[] {
    const result: string[] = [];
    let skipNext = false;
    const LIST_REGEX = /^\s*([-*+]|\d+\.)\s/;

    for (let i = 0; i < pages.length; i++) {
        if (skipNext) {
            skipNext = false;
            continue;
        }
        const current = pages[i];
        if (i === pages.length - 1) {
            result.push(current);
            continue;
        }
        const next = pages[i + 1];

        const currentLines = current.trimEnd().split("\n");
        const nextLines = next.trimStart().split("\n");

        const lastNonEmpty = currentLines.filter(l => l.trim()).pop();
        const firstNonEmpty = nextLines.filter(l => l.trim())[0];

        if (lastNonEmpty && firstNonEmpty && LIST_REGEX.test(lastNonEmpty) && LIST_REGEX.test(firstNonEmpty)) {
            const match1 = lastNonEmpty.match(LIST_REGEX);
            const match2 = firstNonEmpty.match(LIST_REGEX);

            if (match1 && match2) {
                const type1 = match1[1];
                const type2 = match2[1];

                const isUnordered1 = ["-", "*", "+"].includes(type1);
                const isUnordered2 = ["-", "*", "+"].includes(type2);

                if (isUnordered1 === isUnordered2) {
                    result.push(current + "\n" + next);
                    skipNext = true;
                    continue;
                }
            }
        }
        result.push(current);
    }
    return result;
}

function removeDuplicateHeadings(pages: string[]): string[] {
    const headingCounts: Record<string, number> = {};
    const HEADING_REGEX = /^(#{1,2})\s+(.+)$/gm;

    pages.forEach(p => {
        const matches = [...p.matchAll(HEADING_REGEX)];
        matches.forEach(m => {
            const h = m[0].trim();
            headingCounts[h] = (headingCounts[h] || 0) + 1;
        });
    });

    const threshold = pages.length * 0.5;
    const duplicatedHeadings = new Set(
        Object.entries(headingCounts)
            .filter(([, count]) => count > threshold)
            .map(([h]) => h)
    );

    if (duplicatedHeadings.size === 0) return pages;

    const seenHeadings = new Set<string>();

    return pages.map(p => {
        const lines = p.split("\n");
        const filteredLines = lines.filter(line => {
            const match = line.match(/^(#{1,2})\s+(.+)$/);
            if (match) {
                const h = line.trim();
                if (duplicatedHeadings.has(h)) {
                    if (seenHeadings.has(h)) {
                        return false;
                    }
                    seenHeadings.add(h);
                }
            }
            return true;
        });
        return filteredLines.join("\n");
    });
}

function stripModelPreambles(pages: string[]): string[] {
    const PREAMBLE_PATTERNS = [
        /^here is the markdown[:\s]*/i,
        /^here's the markdown[:\s]*/i,
        /^sure[!,.]?\s*/i,
        /^of course[!,.]?\s*/i,
        /^```markdown\n/i,
        /^```\n/,
    ];
    const POSTAMBLE_PATTERNS = [
        /\n```\s*$/,
        /\nI hope this helps.*$/i,
    ];

    return pages.map(p => {
        let content = p.trim();
        for (const pattern of PREAMBLE_PATTERNS) {
            content = content.replace(pattern, "");
        }
        for (const pattern of POSTAMBLE_PATTERNS) {
            content = content.replace(pattern, "");
        }
        return content.trim();
    });
}

function normalizeWhitespace(markdown: string): string {
    return markdown
        .replace(/\n{3,}/g, "\n\n")
        .split("\n").map(l => l.trimEnd()).join("\n") + "\n";
}

export function computeStats(pages: ConvertedPage[], startTime: number): ConversionStats {
    const modelsUsed: Record<ModelId, number> = {
        "gemini-2.5-pro": 0,
        "gemini-2.0-flash": 0,
        "qwen-vl-max": 0,
    };

    let totalTokens = 0;
    let retriedPages = 0;
    let totalServerDurationMs = 0;

    pages.forEach(p => {
        modelsUsed[p.modelUsed] = (modelsUsed[p.modelUsed] || 0) + 1;
        totalTokens += p.tokensUsed || 0;
        if (p.retried) retriedPages++;
        if (p.serverDurationMs) totalServerDurationMs += p.serverDurationMs;
    });

    return {
        totalPages: pages.length,
        totalTokens,
        modelsUsed,
        retriedPages,
        durationMs: Date.now() - startTime,
        totalServerDurationMs,
    };
}
