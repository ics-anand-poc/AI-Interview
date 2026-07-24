/**
 * Common contract every LLM provider (Gemini, Ollama, Copilot, ...) must implement.
 *
 * Keeping this surface tiny (one method) is intentional: every call site in the app
 * already sends a fully-built prompt and expects raw text back, so the provider layer
 * has no business knowing about resumes, interviews, or JSON schemas — that logic stays
 * in src/lib/gemini-ai.ts exactly as it was before this abstraction was introduced.
 */
export interface AIProvider {
  /** Machine-readable provider id, used for logging and cache-key namespacing. */
  readonly name: string;

  /**
   * Send a prompt to the provider and return the raw text response.
   * Implementations should throw a descriptive Error (not return a fallback value)
   * when the provider is unreachable or unconfigured — callers already have their own
   * fallback logic (local heuristics, mock parsers) built around catching that error.
   */
  generateText(prompt: string): Promise<string>;
}
