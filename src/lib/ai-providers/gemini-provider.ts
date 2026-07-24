import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AIProvider } from "./types";

/**
 * Google Gemini provider. This is a behavior-preserving extraction of the
 * initialization/call logic that used to live directly inside GeminiAIEngine.
 *
 * API key is read exclusively from process.env.GEMINI_API_KEY (populated by .env.local
 * in development, or the hosting platform's environment settings in production).
 * No key is ever hardcoded here.
 */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  private model: any = null;
  private initialized = false;

  private ensureInitialized() {
    if (this.initialized) return;

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const ai = new GoogleGenerativeAI(apiKey);
      this.model = ai.getGenerativeModel({
        model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      });
    } else {
      console.warn("GEMINI_API_KEY is not set in the environment (.env.local).");
    }

    this.initialized = true;
  }

  async generateText(prompt: string): Promise<string> {
    this.ensureInitialized();
    if (!this.model) {
      throw new Error("GEMINI_API_KEY is not configured on the server.");
    }

    const result = await this.model.generateContent(prompt);
    const response = await (result as any)?.response;
    return response?.text?.() ?? "";
  }
}
