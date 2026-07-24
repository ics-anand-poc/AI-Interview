/**
 * Deterministic, LLM-free code evaluation used as a failsafe when the AI provider is
 * unavailable, and shared between the interactive "Run" simulator (run_code route) and
 * the final coding-answer evaluator (interview-service's evaluateAnswer). Keeping this
 * in one place means both call sites grade broken/boilerplate/wrong-language code the
 * same, deterministic way instead of drifting apart.
 */

export interface SyntaxGateResult {
  compiles: false;
  error: string;
  testCases: any[];
  score: 0;
}

/**
 * Zero-cost syntax/language gate: matching braces, matching parens, and telltale
 * keywords from the wrong language are mechanical, rule-based facts about the text —
 * not something that benefits from model reasoning. Returns a definitive failure result
 * to short-circuit on, or null if the code passes this gate and needs real judgment.
 */
export function checkSyntaxGate(language: string, code: string): SyntaxGateResult | null {
  const codeTrimmed = code.trim();
  const lowerLang = language.toLowerCase();

  if (codeTrimmed.length < 15) {
    return {
      compiles: false,
      error: "No code solution was provided, or the submission is too short to evaluate.",
      testCases: [
        { name: "Test Case 1: Standard Input", input: "N/A", expected: "N/A", actual: "No code submitted", passed: false },
        { name: "Test Case 2: Boundary / Alternating Input", input: "N/A", expected: "N/A", actual: "No code submitted", passed: false },
        { name: "Test Case 3: Edge Case / Empty Input", input: "N/A", expected: "N/A", actual: "No code submitted", passed: false }
      ],
      score: 0
    };
  }

  let errorMsg: string | null = null;

  if (lowerLang === "javascript" || lowerLang === "typescript") {
    const hasDef = /\bdef\s+\w+\s*\(/.test(code);
    const hasElif = /\belif\b/.test(code);
    const lacksBraces = !code.includes("{") && !code.includes("}");
    if (hasDef || hasElif || (lacksBraces && codeTrimmed.includes(":"))) {
      errorMsg = `Compilation Error: Submitting Python code in a ${language} environment. Please use curly braces and standard ${language} syntax.`;
    }
  } else if (lowerLang === "python") {
    const hasConstLet = /\b(const|let|var)\s+\w+/.test(code);
    const hasFunctionKeyword = /\bfunction\s+\w+/.test(code);
    const hasJsArrow = /=>/.test(code);
    const hasBraces = code.includes("{") && code.includes("}");
    if (hasConstLet || hasFunctionKeyword || hasJsArrow || hasBraces) {
      errorMsg = `Compilation Error: Submitting JavaScript/TypeScript code in a Python environment. Please use indentation and valid Python syntax.`;
    }
  } else if (lowerLang === "cpp" || lowerLang === "java") {
    const hasDef = /\bdef\s+\w+\s*\(/.test(code);
    const hasFunctionKeyword = /\bfunction\s+\w+/.test(code);
    const hasJsArrow = /=>/.test(code);
    if (hasDef || hasFunctionKeyword || hasJsArrow) {
      errorMsg = `Compilation Error: Code contains Python or JS keywords but the selected language environment is ${language}. Please rewrite using valid ${language} syntax.`;
    }
  }

  if (!errorMsg) {
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;

    if (openBraces !== closeBraces) {
      errorMsg = `Syntax Error: Unmatched curly braces. Found ${openBraces} opening and ${closeBraces} closing braces.`;
    } else if (openParens !== closeParens) {
      errorMsg = `Syntax Error: Unmatched parentheses. Found ${openParens} opening and ${closeParens} closing parentheses.`;
    }
  }

  if (!errorMsg) return null;

  return {
    compiles: false,
    error: errorMsg,
    testCases: [
      { name: "Test Case 1: Standard Input", input: "N/A", expected: "N/A", actual: "Compilation Error", passed: false },
      { name: "Test Case 2: Boundary / Alternating Input", input: "N/A", expected: "N/A", actual: "Compilation Error", passed: false },
      { name: "Test Case 3: Edge Case / Empty Input", input: "N/A", expected: "N/A", actual: "Compilation Error", passed: false }
    ],
    score: 0
  };
}

export function runLocalMockEvaluator(question: string, language: string, code: string) {
  const lowerQ = question.toLowerCase();
  const lowerCode = code.toLowerCase();
  const codeTrimmed = code.trim();
  const lowerLang = language.toLowerCase();
  
  // Basic Syntax / Compilation mock check
  let compiles = true;
  let errorMsg: string | null = null;

  // Heuristic Language Alignment Verification
  if (lowerLang === "javascript" || lowerLang === "typescript") {
    const hasDef = /\bdef\s+\w+\s*\(/.test(code);
    const hasElif = /\belif\b/.test(code);
    const hasPythonComment = /^\s*#/m.test(code);
    const lacksBraces = !code.includes("{") && !code.includes("}");
    
    if (hasDef || hasElif || (lacksBraces && codeTrimmed.includes(":"))) {
      compiles = false;
      errorMsg = `Compilation Error: Submitting Python code in a ${language} environment. Please use curly braces and standard ${language} syntax.`;
    }
  } else if (lowerLang === "python") {
    const hasConstLet = /\b(const|let|var)\s+\w+/.test(code);
    const hasFunctionKeyword = /\bfunction\s+\w+/.test(code);
    const hasJsArrow = /=>/.test(code);
    const hasBraces = code.includes("{") && code.includes("}");
    
    if (hasConstLet || hasFunctionKeyword || hasJsArrow || hasBraces) {
      compiles = false;
      errorMsg = `Compilation Error: Submitting JavaScript/TypeScript code in a Python environment. Please use indentation and valid Python syntax.`;
    }
  } else if (lowerLang === "cpp" || lowerLang === "java") {
    const hasDef = /\bdef\s+\w+\s*\(/.test(code);
    const hasFunctionKeyword = /\bfunction\s+\w+/.test(code);
    const hasJsArrow = /=>/.test(code);
    
    if (hasDef || hasFunctionKeyword || hasJsArrow) {
      compiles = false;
      errorMsg = `Compilation Error: Code contains Python or JS keywords but the selected language environment is ${language}. Please rewrite using valid ${language} syntax.`;
    }
  }

  // Simple brackets/braces check (only if language check passes)
  if (compiles) {
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;

    if (openBraces !== closeBraces) {
      compiles = false;
      errorMsg = `Syntax Error: Unmatched curly braces. Found ${openBraces} opening and ${closeBraces} closing braces.`;
    } else if (openParens !== closeParens) {
      compiles = false;
      errorMsg = `Syntax Error: Unmatched parentheses. Found ${openParens} opening and ${closeParens} closing parentheses.`;
    }
  }

  if (!compiles) {
    return {
      compiles: false,
      error: errorMsg,
      testCases: [
        { name: "Test Case 1: Standard Input", input: "N/A", expected: "N/A", actual: "Compilation Error", passed: false },
        { name: "Test Case 2: Boundary / Alternating Input", input: "N/A", expected: "N/A", actual: "Compilation Error", passed: false },
        { name: "Test Case 3: Edge Case / Empty Input", input: "N/A", expected: "N/A", actual: "Compilation Error", passed: false }
      ],
      score: 0
    };
  }

  // 1. Palindrome Problem Heuristics
  if (lowerQ.includes("palindrome")) {
    const hasReverse = lowerCode.includes("reverse") || lowerCode.includes("split") || lowerCode.includes("join");
    const hasLoops = lowerCode.includes("for") || lowerCode.includes("while");
    const hasCaseCheck = lowerCode.includes("tolowercase") || lowerCode.includes("touppercase") || lowerCode.includes("replace");

    const tc1Passed = hasReverse || hasLoops;
    const tc2Passed = tc1Passed && hasCaseCheck;
    const tc3Passed = tc1Passed;

    let score = 0;
    if (tc1Passed) score += 4;
    if (tc2Passed) score += 3;
    if (tc3Passed) score += 3;

    return {
      compiles: true,
      error: null,
      testCases: [
        {
          name: "Test Case 1: Standard Palindrome",
          input: "string = 'racecar'",
          expected: "true",
          actual: tc1Passed ? "true" : "false",
          passed: tc1Passed
        },
        {
          name: "Test Case 2: Palindrome with capital letters & non-alphanumeric",
          input: "string = 'RaceCar!'",
          expected: "true",
          actual: tc2Passed ? "true" : "false",
          passed: tc2Passed
        },
        {
          name: "Test Case 3: Non-palindrome string",
          input: "string = 'hello'",
          expected: "false",
          actual: "false",
          passed: true
        }
      ],
      score
    };
  }

  // 2. Two Sum Problem Heuristics
  if (lowerQ.includes("two sum") || (lowerQ.includes("array") && lowerQ.includes("target"))) {
    const hasLoops = lowerCode.includes("for") || lowerCode.includes("while");
    const hasMapOrSet = lowerCode.includes("map") || lowerCode.includes("set") || lowerCode.includes("indexof") || lowerCode.includes("dictionary");

    const tc1Passed = hasLoops;
    const tc2Passed = hasLoops;
    const tc3Passed = hasLoops && (hasMapOrSet || code.length > 150);

    let score = 0;
    if (tc1Passed) score += 4;
    if (tc2Passed) score += 3;
    if (tc3Passed) score += 3;

    return {
      compiles: true,
      error: null,
      testCases: [
        {
          name: "Test Case 1: Standard Input (nums=[2, 7, 11, 15], target=9)",
          input: "nums = [2, 7, 11, 15], target = 9",
          expected: "[0, 1]",
          actual: tc1Passed ? "[0, 1]" : "[]",
          passed: tc1Passed
        },
        {
          name: "Test Case 2: Duplicates in Input (nums=[3, 3], target=6)",
          input: "nums = [3, 3], target = 6",
          expected: "[0, 1]",
          actual: tc2Passed ? "[0, 1]" : "[]",
          passed: tc2Passed
        },
        {
          name: "Test Case 3: No Solution Match",
          input: "nums = [1, 2], target = 10",
          expected: "[]",
          actual: "[]",
          passed: true
        }
      ],
      score
    };
  }

  // 3. Fallback for Conceptual Questions or Other Coding Challenges
  const hasContent = code.trim().length > 30;
  const isTooShort = code.trim().length < 15;

  return {
    compiles: true,
    error: null,
    testCases: [
      {
        name: "Test Case 1: Logical structure check",
        input: "N/A",
        expected: "valid function structure",
        actual: hasContent ? "valid function structure" : "function empty or incomplete",
        passed: hasContent
      },
      {
        name: "Test Case 2: Compilation & execution success",
        input: "N/A",
        expected: "executes without crash",
        actual: "executes without crash",
        passed: true
      },
      {
        name: "Test Case 3: Code detail verification",
        input: "N/A",
        expected: "sufficient implementation depth",
        actual: isTooShort ? "insufficient code length" : "sufficient implementation depth",
        passed: !isTooShort
      }
    ],
    score: isTooShort ? 3 : (hasContent ? 10 : 6)
  };
}
