import type { ParsedResume } from "@/types/resume";
import { generateAIText } from "@/lib/ai-providers";

/**
 * This class name and the `geminiEngine` singleton below are kept as-is so that every
 * existing import across the codebase (resume-service, interview-service, learning-ai,
 * verify_id, run_code, ...) keeps working unmodified. Under the hood, calls are now routed
 * through src/lib/ai-providers, which picks Gemini / Ollama / Copilot based on the
 * AI_PROVIDER env var (defaults to "gemini") and applies response caching + in-flight
 * de-duplication to cut down on redundant LLM calls.
 */
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

    6. DIMENSION-SPECIFIC SCORING CRITERIA (each of these is a distinct assessment, not just a restatement of the overall score):
       - atsScore (ATS Approach): Score based on machine-parseability, NOT content quality. Check: standard section headers (Experience/Education/Skills), no tables/columns/graphics that break text extraction, consistent date formatting, contact info present and correctly formatted, reverse-chronological order, no missing critical sections. A well-written resume with poor ATS structure should still score low here.
       - technicalScore (Technical Skills Assessment): Score the breadth, depth, and currency of technical skills evidenced by actual project/role usage (not just a skills list) — weight recent, hands-on, production-level usage far higher than skills only mentioned in passing.
       - communicationScore (Communication Assessment): Score writing quality specifically — clarity, active voice vs. passive voice usage, absence of filler/redundant phrasing, grammatical correctness, and appropriate conciseness.
       - impactScore (Impact & Achievement Analysis): Score how well accomplishments are framed with measurable outcomes (metrics, scale, business impact) versus vague responsibility statements ("responsible for X" vs. "reduced X by Y%").

    7. SKILL GAP ANALYSIS (JD comparison only):
       - Identify the specific gap between what the JD requires and what the candidate demonstrates.

    8. EXPERIENCE ASSESSMENT (JD comparison only):
       - Assess the candidate's seniority level and relevant years of experience specifically against what this JD role requires.

    Return ONLY a raw JSON object with no markdown formatting.
    Ensure the JSON matches this exact structure:
    {
      "executiveSummary": "A 2-3 sentence summary of the candidate's profile highlighting their fit.",
      "overallScore": 85, // out of 100
      "atsScore": 80, // out of 100 — parseability/structure only, see criteria above
      "technicalScore": 90, // out of 100 — depth/currency of technical skills, see criteria above
      "impactScore": 75, // out of 100 — quantified achievement framing, see criteria above
      "communicationScore": 85, // out of 100 — writing quality specifically, see criteria above
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
      "skillGapAnalysis": {
        "missingCoreSkills": ["Core JD skill the candidate does not demonstrate at all"],
        "weakCoreSkills": ["Core JD skill present but shallow/outdated/non-recent"],
        "missingSecondarySkills": ["Nice-to-have JD skill not demonstrated"],
        "transferableSkills": ["Candidate skill not explicitly in the JD but reasonably transferable to close a gap"]
      },
      "experienceAssessment": {
        "candidateSeniorityLevel": "e.g. Mid-Level (3-5 yrs)",
        "jdRequiredSeniorityLevel": "e.g. Senior (5+ yrs)",
        "relevantYearsOfExperience": 4,
        "seniorityFitRationale": "1-2 sentence explanation of whether/how the candidate's experience level matches what this role requires."
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

    DIMENSION-SPECIFIC SCORING CRITERIA (each of these is a distinct assessment, not just a restatement of the overall score):
    - atsScore (ATS Approach): Score based on machine-parseability, NOT content quality. Check: standard section headers (Experience/Education/Skills), no tables/columns/graphics that break text extraction, consistent date formatting, contact info present and correctly formatted, reverse-chronological order, no missing critical sections. A well-written resume with poor ATS structure should still score low here.
    - technicalScore (Technical Skills Assessment): Score the breadth, depth, and currency of technical skills evidenced by actual project/role usage (not just a skills list) — weight recent, hands-on, production-level usage far higher than skills only mentioned in passing.
    - communicationScore (Communication Assessment): Score writing quality specifically — clarity, active voice vs. passive voice usage, absence of filler/redundant phrasing, grammatical correctness, and appropriate conciseness.
    - impactScore (Impact & Achievement Analysis): Score how well accomplishments are framed with measurable outcomes (metrics, scale, business impact) versus vague responsibility statements ("responsible for X" vs. "reduced X by Y%").

    Ensure the JSON matches this exact structure:
    {
      "executiveSummary": "A 2-3 sentence summary of the candidate's profile.",
      "overallScore": 85, // out of 100
      "atsScore": 80, // out of 100 — parseability/structure only, see criteria above
      "technicalScore": 90, // out of 100 — depth/currency of technical skills, see criteria above
      "impactScore": 75, // out of 100 — quantified achievement framing, see criteria above
      "communicationScore": 85, // out of 100 — writing quality specifically, see criteria above
      "scores": {
        "actionVerbs": 80,
        "measurability": 70,
        "formatting": 90,
        "clarity": 85,
        "consistency": 95,
        "keywordOptimization": 80
      },
      "experienceAssessment": {
        "seniorityLevel": "e.g. Mid-Level (3-5 yrs)",
        "totalYearsOfExperience": 4,
        "assessmentRationale": "1-2 sentence explanation of how seniority level was determined from the resume."
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
      let textResponse = await generateAIText(prompt);

      // Clean up markdown if the model returns it despite instructions
      textResponse = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
      
      try {
        return JSON.parse(textResponse);
      } catch (parseError) {
        console.error("Failed to parse AI response:", textResponse);
        throw new Error("AI returned malformed JSON response.");
      }
    } catch (error: any) {
      console.error("AI Analysis Error:", error.message || error);
      throw new Error(`AI Analysis Failed: ${error.message || "Unknown error"}`);
    }
  }

  // Fallback for smaller rewrites
  enhanceBulletPoint(bullet: string, context: string): string {
    return bullet; // Handled by LLM if we want, or fallback to local
  }

  async generateText(prompt: string): Promise<any> {
    const textResponse = await generateAIText(prompt);

    // Clean up markdown block styling
    let cleaned = textResponse.trim();
    
    // Find bracket boundaries for JSON
    const arrayStart = cleaned.indexOf('[');
    const objStart = cleaned.indexOf('{');
    let startIdx = -1;
    let endIdx = -1;

    if (arrayStart !== -1 && (objStart === -1 || arrayStart < objStart)) {
      startIdx = arrayStart;
      endIdx = cleaned.lastIndexOf(']');
    } else if (objStart !== -1) {
      startIdx = objStart;
      endIdx = cleaned.lastIndexOf('}');
    }

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      cleaned = cleaned.substring(startIdx, endIdx + 1);
    } else {
      // Fallback manual replacement
      cleaned = cleaned.replace(/```json/gi, '').replace(/```/g, '').trim();
    }

    try {
      return JSON.parse(cleaned);
    } catch (parseError) {
      console.error("Failed to parse Gemini JSON response. Raw was:", textResponse);
      throw parseError;
    }
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
    idMimeType: string,
    selfieImageBase64: string,
    selfieMimeType: string
  ): Promise<{ matched: boolean; confidence: number; reason: string }> {
    const { exec } = require("child_process");
    const { promisify } = require("util");
    const { writeFile, unlink } = require("fs/promises");
    const { join } = require("path");
    const fs = require("fs");
    const execPromise = promisify(exec);

    const cleanBase64 = (base64Str: string) => {
      const match = base64Str.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return { mimeType: match[1], data: match[2] };
      }
      return { mimeType: null, data: base64Str };
    };

    const idData = cleanBase64(idImageBase64);
    const selfieData = cleanBase64(selfieImageBase64);

    const tempDir = join(process.cwd(), "uploads", "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const idTempPath = join(tempDir, `temp_id_${Date.now()}_${Math.random().toString(36).substring(7)}.png`);
    const selfieTempPath = join(tempDir, `temp_selfie_${Date.now()}_${Math.random().toString(36).substring(7)}.png`);

    try {
      await writeFile(idTempPath, Buffer.from(idData.data, "base64"));
      await writeFile(selfieTempPath, Buffer.from(selfieData.data, "base64"));

      const pythonScriptPath = join(process.cwd(), "faceproj", "compare_images.py");
      const cmd = `python "${pythonScriptPath}" "${idTempPath}" "${selfieTempPath}"`;
      
      console.log(`Executing local biometric check command: ${cmd}`);
      const { stdout } = await execPromise(cmd);
      console.log("Local biometric check result:", stdout);

      // Clean up temp files
      try {
        await unlink(idTempPath);
        await unlink(selfieTempPath);
      } catch (e) {
        console.warn("Failed to clean up temp files:", e);
      }

      // Parse JSON result from stdout
      const jsonStart = stdout.indexOf("{");
      const jsonEnd = stdout.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr);
        return {
          matched: typeof parsed.matched === "boolean" ? parsed.matched : parsed.matched === "true" || parsed.confidence >= 70,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : parseInt(parsed.confidence) || 0,
          reason: parsed.reason || "Local face match complete."
        };
      } else {
        throw new Error(`Python output did not contain valid JSON: ${stdout}`);
      }

    } catch (error: any) {
      console.error("Local face match verification error:", error);
      try {
        if (fs.existsSync(idTempPath)) await unlink(idTempPath);
        if (fs.existsSync(selfieTempPath)) await unlink(selfieTempPath);
      } catch (cleanupErr) {
        console.warn("Failed to clean up temp files on error:", cleanupErr);
      }
      throw new Error(`Local Biometric Match Failed: ${error.message || "Unknown error"}`);
    }
  }
}

export const geminiEngine = new GeminiAIEngine();
