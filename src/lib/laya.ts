/**
 * Local Laya (typed decisions). Not a chat LLM — choice / score / yes-no only.
 * Sidecar: AI/laya/start.bat  →  http://127.0.0.1:8090
 */

const DEFAULT_BASE = "http://127.0.0.1:8090";

export function layaBaseUrl(): string {
  return String(process.env.LAYA_URL || DEFAULT_BASE).replace(/\/$/, "");
}

export function layaEnabled(): boolean {
  const raw = String(process.env.LAYA_ENABLED || "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export async function layaIsUp(): Promise<boolean> {
  if (!layaEnabled()) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${layaBaseUrl()}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

export type LayaFileKind = "corp_pool" | "jd" | "br" | "portal_mapping" | "unknown";

export type LayaClassifyResult = {
  kind: LayaFileKind;
  confidence: number;
  prob: number;
  why: string;
};

const KINDS: LayaFileKind[] = ["corp_pool", "jd", "br", "portal_mapping", "unknown"];

export async function classifyHrFileWithLaya(input: {
  fileName: string;
  preview: string;
}): Promise<LayaClassifyResult | null> {
  if (!layaEnabled()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let res: Response;
  try {
    res = await fetch(`${layaBaseUrl()}/v1/classify-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: input.fileName,
        preview: input.preview.slice(0, 1400),
      }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return null;
  }
  clearTimeout(timer);
  if (!res.ok) return null;
  const data = (await res.json()) as { kind?: string; confidence?: number; prob?: number; why?: string };
  const kind = KINDS.includes(data.kind as LayaFileKind) ? (data.kind as LayaFileKind) : "unknown";
  const confidence = Number(data.confidence);
  const prob = Number(data.prob);
  return {
    kind,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    prob: Number.isFinite(prob) ? prob : 0,
    why: String(data.why || "").trim() || `Laya classified as ${kind}.`,
  };
}

export async function scoreVectorsWithLaya(input: {
  jdTitle: string;
  designation?: string;
  jdVec: string[];
  cvVec: string[];
  overlap: string[];
  missing: string[];
  headline: string[];
}): Promise<{ score: number; wrongFamily: number; decision: string; rationale: string }> {
  if (!layaEnabled()) throw new Error(layaUnavailableMessage());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${layaBaseUrl()}/v1/score-vectors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    throw new Error(layaUnavailableMessage());
  }
  clearTimeout(timer);
  if (!res.ok) throw new Error(`Laya scoring failed (${res.status}).`);
  const data = (await res.json()) as {
    score?: number;
    wrongFamily?: number;
    decision?: string;
    why?: string;
  };
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(data.score) || 0))),
    wrongFamily: Number(data.wrongFamily) || 0,
    decision: String(data.decision || ""),
    rationale: String(data.why || "").trim() || `Laya score ${data.score}.`,
  };
}

export function layaUnavailableMessage(): string {
  return `Laya is not running. Keep npm run laya open (server ${layaBaseUrl()}).`;
}

export type LayaPersonScore = {
  score: number;
  coverage: number;
  wrongFamily: number;
  hits: string[];
  misses: string[];
  decision: string;
  rationale: string;
  confidence: number;
};

export async function scorePersonWithLaya(input: {
  jdFileName: string;
  jdTitle?: string;
  jdText: string;
  mandatorySkills: string[];
  person: {
    employee_id: string;
    full_name: string;
    designation?: string;
    grade?: string;
    skills?: string;
  };
}): Promise<LayaPersonScore> {
  if (!layaEnabled()) {
    throw new Error(layaUnavailableMessage());
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(`${layaBaseUrl()}/v1/score-person`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jdFileName: input.jdFileName,
        jdTitle: input.jdTitle || "",
        jdText: input.jdText.slice(0, 500),
        mandatorySkills: input.mandatorySkills.slice(0, 8),
        person: input.person,
      }),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    throw new Error(layaUnavailableMessage());
  }
  clearTimeout(timer);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(String((err as { error?: string }).error || `Laya scoring failed (${res.status}).`));
  }
  const data = (await res.json()) as {
    score?: number;
    coverage?: number;
    wrongFamily?: number;
    hits?: string[];
    misses?: string[];
    decision?: string;
    why?: string;
    confidence?: number;
  };
  const score = Math.max(0, Math.min(100, Math.round(Number(data.score) || 0)));
  return {
    score,
    coverage: Math.max(0, Math.min(100, Math.round(Number(data.coverage) || score))),
    wrongFamily: Number(data.wrongFamily) || 0,
    hits: Array.isArray(data.hits) ? data.hits.map(String) : [],
    misses: Array.isArray(data.misses) ? data.misses.map(String) : [],
    decision: String(data.decision || ""),
    rationale: String(data.why || "").trim() || `Laya score ${score}.`,
    confidence: Number(data.confidence) || 0,
  };
}
