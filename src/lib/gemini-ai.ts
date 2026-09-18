import type { ParsedResume } from "@/types/resume";
import { localLlmCompleteJson } from "@/lib/local-llm";

/** Interview / resume / learning text AI. Backed only by local Qwen3.5-27B (llamafile). */
export class GeminiAIEngine {
  async analyzeResume(text: string, parsed: ParsedResume, jdText?: string): Promise<any> {

    const isJDMatch = !!jdText && jdText.trim().length > 0;

    const prompt = isJDMatch ? `
    You are a principal technical recruiter and an elite CV-to-Job-Description matching engine.
    Perform a highly precise, critical, and objective evaluation of the candidate's suitability for the provided Job Description (JD).
    
    Job Description:
    ${jdText}
    
    Resume Text:
    ${text.substring(0, 10000)} // Truncate to save tokens, preserving full context

    Parsed Structure:
    ${JSON.stringify(parsed, null, 2)}

    RIGOROUS EVALUATION CRITERIA:
    1. CORE VS. PREFERRED SKILLS:
       - Must-Have (Core) Skills: Identify the primary required technologies and qualifications in the JD.
       - Nice-to-Have (Secondary) Skills: Identify optional or preferred skills in the JD.
       - Evidence Check: Look for actual evidence of these technologies in the candidate's "Work Experience" details. Do not rely solely on a summary or tags in a "Skills" section without corresponding project/role context. If a skill only appears in a skills dump list without experience context, reduce its matching weight by 50%.
    
    2. RECENCY & DURATION:
       - Calculate the duration of usage for core skills (e.g., 5+ years vs. 3 months).
       - Assess recency: Is the candidate currently using the technology, or was it used in a distant past role? Recent usage carries much higher weight.
       
    3. ROLE LEVEL & SENIORITY FIT:
       - Compare candidate seniority level (e.g., Junior, Mid, Senior, Lead) with the JD requirements. A senior JD requires senior-level design, leadership, or architecture achievements.
       
    4. STRICT SCORING RUBRIC (BE EXTREMELY CRITICAL - DO NOT INFLATE SCORES):
       - 85 - 100 (Exceptional Fit): Meets all core and almost all secondary requirements with extensive, recent, and hands-on experience at or above the required seniority level.
       - 70 - 84 (Strong Fit): Meets all core requirements and has some preferred skills, with recent experience.
       - 55 - 69 (Moderate/Fair Fit): Meets most core requirements but has gaps in some key areas, or has the core skills but with limited depth or non-recent usage.
       - 40 - 54 (Weak Fit): Missing major core technical requirements or lacks sufficient seniority, but has basic overlapping competencies.
       - Under 40 (Unsuitable Fit): Missing core requirements, lacks overall eligibility, or severe seniority mismatch.
    
    5. SUITABILITY CLASSIFICATION:
       - "suitable": strictly if the jdMatchScore is >= 40 AND they possess the baseline core technical skills.
       - "unsuitable": strictly if the jdMatchScore is < 40 OR they lack the fundamental core technologies required by the JD.
    
    Return ONLY a raw JSON object with no markdown formatting.
    Ensure the JSON matches this exact structure:
    {
      "executiveSummary": "A 2-3 sentence summary of the candidate's profile highlighting their fit.",
      "overallScore": 85, // out of 100
      "atsScore": 80, // out of 100
      "technicalScore": 90, // out of 100
      "impactScore": 75, // out of 100
      "communicationScore": 85, // out of 100
      "scores": {
        "actionVerbs": 80,
        "measurability": 70,
        "formatting": 90,
        "clarity": 85,
        "consistency": 95,
        "keywordOptimization": 80
      },
      "weaknesses": [
        {
          "category": "technical",
          "severity": "high", // high, medium, low
          "location": "Experience Section",
          "description": "Lacks experience in React and Node.js which are core required technologies.",
          "suggestion": "Gain experience with React or Node.js.",
          "examples": []
        }
      ],
      "strengths": [
        {
          "category": "Technical",
          "description": "Strong full-stack experience",
          "impact": "high" // high, medium, low
        }
      ],
      "targetRoles": ["Senior Frontend Developer", "Full Stack Engineer"], // Be highly accurate based on skills and experience
      "industryFit": [
        {
          "industry": "Software Development",
          "matchScore": 95, // out of 100
          "rationale": "Extensive experience with modern web frameworks"
        }
      ],
      "keywordAnalysis": {
        "suggestedKeywords": ["Docker", "CI/CD", "Testing"]
      },
      "suitability": "suitable", // MUST be either "suitable" or "unsuitable"
      "jdMatchScore": 75, // 0 to 100 rating how well they fit the JD
      "jdMatchRationale": "Detailed 2-3 sentence reason. Must name specifically: 1. Core tech that matched, 2. Core tech/experience elements that were missing/weak, 3. Summary of experience fit."
    }` : `
    You are an expert technical recruiter and resume analyst.
    Analyze the following resume text and parsed structure. Provide a highly accurate, critical evaluation.
    Return ONLY a raw JSON object with no markdown formatting.

    Resume Text:
    ${text.substring(0, 5000)} // Truncate to save tokens

    Parsed Structure:
    ${JSON.stringify(parsed, null, 2)}

    Ensure the JSON matches this exact structure:
    {
      "executiveSummary": "A 2-3 sentence summary of the candidate's profile.",
      "overallScore": 85, // out of 100
      "atsScore": 80, // out of 100
      "technicalScore": 90, // out of 100
      "impactScore": 75, // out of 100
      "communicationScore": 85, // out of 100
      "scores": {
        "actionVerbs": 80,
        "measurability": 70,
        "formatting": 90,
        "clarity": 85,
        "consistency": 95,
        "keywordOptimization": 80
      },
      "weaknesses": [
        {
          "category": "impact",
          "severity": "high", // high, medium, low
          "location": "Experience Section",
          "description": "Lacks quantifiable metrics in the recent role",
          "suggestion": "Add concrete numbers to demonstrate impact",
          "examples": ["Developed new feature"]
        }
      ],
      "strengths": [
        {
          "category": "Technical",
          "description": "Strong full-stack experience",
          "impact": "high" // high, medium, low
        }
      ],
      "targetRoles": ["Senior Frontend Developer", "Full Stack Engineer"], // Be highly accurate based on skills and experience
      "industryFit": [
        {
          "industry": "Software Development",
          "matchScore": 95, // out of 100
          "rationale": "Extensive experience with modern web frameworks"
        }
      ],
      "keywordAnalysis": {
        "suggestedKeywords": ["Docker", "CI/CD", "Testing"]
      }
    }`;

    try {
      return await localLlmCompleteJson(prompt, { maxTokens: 3072, timeoutMs: 300_000 });
    } catch (error: any) {
      console.error("Local Qwen resume analysis failed:", error.message || error);
      throw new Error(`Local Qwen analysis failed: ${error.message || "Unknown error"}`);
    }
  }

  // Fallback for smaller rewrites
  enhanceBulletPoint(bullet: string, context: string): string {
    return bullet; // Handled by LLM if we want, or fallback to local
  }

  async generateText(prompt: string): Promise<any> {
    return localLlmCompleteJson(prompt, { maxTokens: 3072, timeoutMs: 300_000 });
  }

  generateSuggestions(analysis: any): any[] {
    // Generate actionable suggestions based on weaknesses from LLM
    if (!analysis || !analysis.weaknesses) return [];
    
    return analysis.weaknesses.map((w: any, i: number) => ({
      type: "modify",
      section: w.location.toLowerCase().includes("experience") ? "experience" : "summary",
      priority: w.severity,
      description: w.description,
      rationale: w.suggestion
    }));
  }

  async verifyFaceMatch(
    idImageBase64: string,
    _idMimeType: string,
    selfieImageBase64: string,
    _selfieMimeType: string
  ): Promise<{ matched: boolean; confidence: number; reason: string }> {
    const { verifyFaceBiometricsOnly } = await import("@/lib/identity-verification");
    return verifyFaceBiometricsOnly(idImageBase64, selfieImageBase64);
  }
}

export const geminiEngine = new GeminiAIEngine();
