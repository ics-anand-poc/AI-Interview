import { generateAIText } from "@/lib/ai-providers";
import { localEngine } from "@/lib/local-ai";

/**
 * Resume bullet-point / summary rewriting is a genuinely generative task — producing
 * clearer, more impactful phrasing — which is exactly where an LLM adds real value over
 * mechanical rules (unlike, say, JD field extraction, which stays hardcoded elsewhere in
 * this app). This module sends ALL of a resume's bullet points in a SINGLE batched LLM
 * call (not one call per bullet, which would be both slow and needlessly expensive for a
 * resume with a dozen-plus bullets), and falls back to the existing local rule-based
 * rewriter for any item the LLM call doesn't return or if the call fails entirely.
 */

export interface EnhancementItem {
  id: string;
  text: string;
}

export async function enhanceTextItemsWithAI(
  items: EnhancementItem[],
  context: { jdText?: string; targetRoles?: string[] }
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (items.length === 0) return result;

  try {
    const prompt = `
You are an expert resume writer. Rewrite each of the following resume text items to be more
impactful, concise, and achievement-oriented — use strong action verbs, quantify impact where
plausible from context (do not invent specific numbers that aren't implied by the original text),
and remove filler/redundant phrasing. Preserve the original meaning and any concrete facts
(technologies, company names, outcomes) exactly — do not fabricate new claims.

${context.jdText ? `Tailor phrasing toward relevance for this target role/JD where it fits naturally (without fabricating unrelated experience):\n${context.jdText.substring(0, 2000)}\n` : ""}

Items to rewrite (JSON array of {id, text}):
${JSON.stringify(items, null, 2)}

Return ONLY a raw JSON array with this exact structure, one entry per input item, in any order:
[
  { "id": "the same id from the input", "enhanced": "the rewritten text" }
]
`;

    const raw = await generateAIText(prompt);
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry && typeof entry.id === "string" && typeof entry.enhanced === "string" && entry.enhanced.trim()) {
          result.set(entry.id, entry.enhanced.trim());
        }
      }
    }
  } catch (err) {
    console.warn("Batched AI bullet-point enhancement failed, using local rule-based rewriter for all items.", err);
  }

  // Anything the LLM didn't return (partial response, or the call failed entirely)
  // still gets rewritten — just via the deterministic local engine instead of skipped.
  for (const item of items) {
    if (!result.has(item.id)) {
      result.set(item.id, localEngine.enhanceBulletPoint(item.text, ""));
    }
  }

  return result;
}
