/**
 * Local Qwen via llamafile (OpenAI-compatible HTTP).
 * 4B: AI/start.sh on the Azure VM (2 vCPU / 4 GB). 14B will not fit that box.
 */
const DEFAULT_BASE = "http://127.0.0.1:8080";
const DEFAULT_MODEL = "Qwen3.5-4B-Q4_K_M";

export function localLlmBaseUrl(): string {
  return String(process.env.LOCAL_LLM_URL || DEFAULT_BASE).replace(/\/$/, "");
}

export function localLlmModelName(): string {
  return String(process.env.LOCAL_LLM_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

export function localLlmApiKey(): string {
  return String(process.env.LOCAL_LLM_API_KEY || process.env.LLAMA_API_KEY || "").trim();
}

function llmHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = localLlmApiKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export function localLlmUnavailableMessage(): string {
  const how =
    process.platform === "win32"
      ? "Keep npm run llm running (AI\\start.bat). It must stay up; the app calls it with LOCAL_LLM_API_KEY"
      : "Keep AI/start.sh running. The app calls it with LOCAL_LLM_API_KEY";
  return `Local Qwen (${localLlmModelName()}) is not running. ${how} (server ${localLlmBaseUrl()}).`;
}

function stripThink(text: string): string {
  return String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

export function extractJsonPayload(raw: string): string {
  let cleaned = stripThink(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
  const arrayStart = cleaned.indexOf("[");
  const objStart = cleaned.indexOf("{");
  let startIdx = -1;
  let endIdx = -1;
  if (arrayStart !== -1 && (objStart === -1 || arrayStart < objStart)) {
    startIdx = arrayStart;
    endIdx = cleaned.lastIndexOf("]");
  } else if (objStart !== -1) {
    startIdx = objStart;
    endIdx = cleaned.lastIndexOf("}");
  }
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return cleaned.slice(startIdx, endIdx + 1);
  }
  if (startIdx !== -1) return cleaned.slice(startIdx);
  return cleaned;
}

/** Close truncated JSON from small models that hit max_tokens mid-string. */
export function repairJsonObject(raw: string): string {
  let s = extractJsonPayload(raw).trim();
  if (!s) return s;
  const quoteCount = (s.match(/"/g) || []).length;
  if (quoteCount % 2 === 1) s += '"';
  let braces = 0;
  let brackets = 0;
  for (const ch of s) {
    if (ch === "{") braces += 1;
    else if (ch === "}") braces -= 1;
    else if (ch === "[") brackets += 1;
    else if (ch === "]") brackets -= 1;
  }
  if (brackets > 0) s += "]".repeat(brackets);
  if (braces > 0) s += "}".repeat(braces);
  return s;
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: llmHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Raw completion from the llamafile server. Throws if the local model is down.
 */
export async function localLlmComplete(
  prompt: string,
  opts?: { temperature?: number; maxTokens?: number; system?: string; timeoutMs?: number }
): Promise<string> {
  const base = localLlmBaseUrl();
  const temperature = opts?.temperature ?? 0.2;
  const maxTokens = opts?.maxTokens ?? 512;
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  const system =
    opts?.system ||
    "You are a precise assistant for an HR screening app. Do not use chain-of-thought. Reply with the requested output only.";

  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];
  const chatBody = {
    model: localLlmModelName(),
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
    chat_template_kwargs: { enable_thinking: false },
    reasoning: "off",
  };
  const slimBody = {
    model: localLlmModelName(),
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };

  try {
    let chatRes = await postJson(`${base}/v1/chat/completions`, chatBody, timeoutMs);
    if (chatRes.status === 400) {
      chatRes = await postJson(`${base}/v1/chat/completions`, slimBody, timeoutMs);
    }
    if (chatRes.status === 401 || chatRes.status === 403) {
      throw new Error(
        "Local Qwen rejected LOCAL_LLM_API_KEY. Put the same secret in .env.local and AI/.llm-api-key, then restart npm run dev."
      );
    }
    if (!chatRes.ok) {
      throw new Error(`Local LLM HTTP ${chatRes.status}`);
    }
    const json = (await chatRes.json()) as {
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string };
        text?: string;
      }>;
    };
    const message = json.choices?.[0]?.message;
    const text = message?.content || json.choices?.[0]?.text || "";
    if (!String(text).trim()) {
      throw new Error("Local LLM returned an empty response");
    }
    return stripThink(text);
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Local Qwen (${localLlmModelName()}) timed out. 4B on 2 vCPUs is slow — wait, or use a bigger VM / GPU.`);
    }
    const message = String(err?.message || err);
    if (/fetch|ECONNREFUSED|ENOTFOUND|Failed to fetch|network/i.test(message)) {
      throw new Error(localLlmUnavailableMessage());
    }
    throw err instanceof Error ? err : new Error(message);
  }
}

export async function localLlmCompleteJson(
  prompt: string,
  opts?: { temperature?: number; maxTokens?: number; timeoutMs?: number }
): Promise<any> {
  const raw = await localLlmComplete(prompt, {
    ...opts,
    system:
      "You are a precise HR assistant. Return ONLY valid JSON. No markdown. No chain-of-thought.",
  });
  const payload = extractJsonPayload(raw);
  try {
    return JSON.parse(payload);
  } catch {
    try {
      return JSON.parse(repairJsonObject(raw));
    } catch {
      throw new Error(`Local Qwen returned malformed JSON: ${payload.slice(0, 240)}`);
    }
  }
}

export async function localLlmIsUp(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const headers = llmHeaders();
    const res = await fetch(`${localLlmBaseUrl()}/health`, { signal: controller.signal, headers }).catch(
      async () => fetch(`${localLlmBaseUrl()}/v1/models`, { signal: controller.signal, headers })
    );
    clearTimeout(timer);
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}
