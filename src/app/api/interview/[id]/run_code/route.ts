export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { geminiEngine } from '@/lib/gemini-ai';
import { checkSyntaxGate, runLocalMockEvaluator } from '@/lib/code-eval-fallback';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: resumeId } = await params;
    const body = await request.json();
    const { question_index, question, language, code } = body;

    if (!question || !language || !code) {
      return NextResponse.json({ error: 'Missing required fields: question, language, code' }, { status: 400 });
    }

    // Hardcoded gate first — skip the LLM call entirely for definite, mechanical failures.
    const gateResult = checkSyntaxGate(language, code);
    if (gateResult) {
      console.log(`Syntax gate rejected submission for resume ${resumeId} without calling the LLM (deterministic check).`);
      return NextResponse.json(gateResult);
    }

    const prompt = `
    You are an elite automated code runner, compiler simulator, and grading engine.
    Your task is to compile and run the candidate's code against exactly 3 distinct test cases (including normal inputs and edge cases) for the specified coding challenge, strictly simulating execution in the specified programming language.

    Coding Challenge:
    "${question}"

    Programming Language:
    "${language}"

    Candidate's Code Solution:
    \`\`\`${language}
    ${code}
    \`\`\`

    EXECUTION & COMPILATION SIMULATION STEPS:
    1. SYNTAX & COMPILATION CHECK:
       - STRICT LANGUAGE CHECK: Check if the candidate's code is written using the proper syntax, keywords, and structural patterns of the selected programming language ("${language}").
       - If the code belongs to a different programming language (for instance, if "def " or Python indentation is used when JavaScript/TypeScript/Java/C++ is selected, or if braces and "const/function" are used when Python is selected), you MUST fail compilation. Set "compiles" to false, and in "error" output a clear syntax compilation error (e.g. "Compilation Error: Python syntax cannot be compiled in a ${language} environment").
       - Check the code for standard syntax or compile errors based on "${language}" specifications.
       - If there are syntax or compiler errors, set "compiles" to false, and provide the compiler-like stderr message in "error" (e.g. Line numbers, error details). All "passed" values in test cases should be false, and "actual" should show the compilation/syntax error.
    2. TEST CASE GENERATION:
       - Create exactly 3 distinct test cases for the problem description.
       - Each test case must check a specific behavior:
         - Test Case 1: Standard / Happy path input.
         - Test Case 2: Standard input with slightly different bounds or parameters.
         - Test Case 3: Edge case (e.g. empty input, null, zeros, single item, boundary values, or case-sensitivity).
    3. STEP-BY-STEP SIMULATION (DRY RUN):
       - If compilation succeeded, trace the execution of the candidate's code step-by-step against each test case.
       - Record the exact return value or stdout as "actual".
       - Check if "actual" value matches the "expected" output. If it does, set "passed" to true, else false.
    4. CORRECTNESS SCORING:
       - Set a score from 0 to 10 based on how many test cases passed and the general correctness of the code. (e.g., all pass = 10, partial correctness = 4-8, compilation failure = 0).

    OUTPUT FORMAT:
    - You MUST return ONLY a JSON object.
    - Do NOT wrap in markdown code blocks.
    - Follow this JSON schema exactly:
    {
      "compiles": true,
      "error": null,
      "testCases": [
        {
          "name": "Test Case 1: Standard Palindrome",
          "input": "string = 'racecar'",
          "expected": "true",
          "actual": "true",
          "passed": true
        },
        {
          "name": "Test Case 2: Palindrome with capital letters",
          "input": "string = 'RaceCar'",
          "expected": "true",
          "actual": "true",
          "passed": true
        },
        {
          "name": "Test Case 3: Non-palindrome string",
          "input": "string = 'hello'",
          "expected": "false",
          "actual": "false",
          "passed": true
        }
      ],
      "score": 10
    }
    `;

    console.log(`Running compiler/sandbox simulation for resume ${resumeId}, language ${language}...`);
    try {
      const result = await geminiEngine.generateText(prompt);
      return NextResponse.json(result);
    } catch (geminiErr: any) {
      console.warn("Gemini sandbox compiler failed (rate limit or quota limit). Falling back to local heuristic runner...", geminiErr);
      const fallbackResult = runLocalMockEvaluator(question, language, code);
      return NextResponse.json(fallbackResult);
    }
  } catch (err: any) {
    console.error("Error simulating code run:", err);
    return NextResponse.json({ 
      compiles: false, 
      error: `Compiler Sandbox Error: ${err.message || 'Unknown execution error'}`, 
      testCases: [],
      score: 0 
    }, { status: 500 });
  }
}
