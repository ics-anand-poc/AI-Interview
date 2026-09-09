/**
 * Production identity verification: document-type check + biometric face match.
 * ID photos use FaceNet / browser face-api.
 */
import {
  getIdTypeLabel,
  isGovernmentIdType,
  type GovernmentIdType,
  type VerificationFailureCode,
} from "@/lib/identity-verification-shared";
import {
  isFaceDescriptor,
  matchFaceDescriptors,
} from "@/lib/face-descriptor-match";

export type {
  GovernmentIdType,
  VerificationFailureCode,
} from "@/lib/identity-verification-shared";
export {
  GOVERNMENT_ID_TYPES,
  getIdTypeLabel,
  isGovernmentIdType,
  normalizeDetectedIdType,
} from "@/lib/identity-verification-shared";

export interface IdentityVerificationResult {
  matched: boolean;
  confidence: number;
  reason: string;
  selectedIdType: GovernmentIdType | null;
  detectedIdType: string | null;
  idTypeMatched: boolean;
  faceMatched: boolean;
  failureCode?: VerificationFailureCode;
  engine: "gemini" | "facenet" | "hybrid" | "faceapi" | "none";
  isSystemError?: boolean;
}

function stripDataUrl(base64OrDataUrl: string): { mimeType: string; data: string } {
  const match = base64OrDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mimeType: match[1], data: match[2] };
  return { mimeType: "image/jpeg", data: base64OrDataUrl };
}

function parseJsonFromModel(text: string): any {
  let cleaned = text.trim();
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    cleaned = cleaned.substring(objStart, objEnd + 1);
  } else {
    cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").trim();
  }
  return JSON.parse(cleaned);
}

function canUseLocalFaceNet(): boolean {
  if (process.env.FACE_MATCH_FORCE_CLOUD === "1") return false;
  if (process.env.FACE_MATCH_FORCE_LOCAL === "1") return true;
  // Prefer remote FaceNet service on hosted (Render) over spawning Python locally.
  if (process.env.FACE_MATCH_SERVICE_URL) return false;
  // Serverless / container hosts usually have no Python+torch stack
  if (process.env.VERCEL === "1") return false;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  return true;
}

/**
 * Production FaceNet on Render (or any always-on Docker host).
 * Set FACE_MATCH_SERVICE_URL=https://your-service.onrender.com
 * Optional FACE_MATCH_API_KEY must match the service env.
 */
async function runRemoteFaceNetService(
  idImageBase64: string,
  selfieImageBase64: string
): Promise<{
  matched: boolean;
  confidence: number;
  reason: string;
  failureCode?: VerificationFailureCode;
} | null> {
  const baseUrl = (process.env.FACE_MATCH_SERVICE_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) return null;

  const apiKey = (process.env.FACE_MATCH_API_KEY || "").trim();
  const controller = new AbortController();
  const timeoutMs = Number(process.env.FACE_MATCH_TIMEOUT_MS || 90_000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-Face-Match-Key": apiKey } : {}),
      },
      body: JSON.stringify({
        idImage: idImageBase64,
        selfieImage: selfieImageBase64,
        ...(apiKey ? { apiKey } : {}),
      }),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Remote FaceNet service error:", res.status, payload);
      return null;
    }

    const failureRaw = String(payload.failureCode || "");
    const failureCode: VerificationFailureCode | undefined =
      failureRaw === "no_face_on_id" || failureRaw === "no_face_on_selfie"
        ? failureRaw
        : undefined;

    return {
      matched: Boolean(payload.matched),
      confidence:
        typeof payload.confidence === "number"
          ? payload.confidence
          : parseInt(String(payload.confidence), 10) || 0,
      reason: String(payload.reason || "Remote FaceNet comparison complete."),
      failureCode,
    };
  } catch (err) {
    console.error("Remote FaceNet service call failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runLocalFaceNet(
  idImageBase64: string,
  selfieImageBase64: string
): Promise<{
  matched: boolean;
  confidence: number;
  reason: string;
  failureCode?: VerificationFailureCode;
} | null> {
  if (!canUseLocalFaceNet()) return null;

  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const { writeFile, unlink, mkdir } = await import("fs/promises");
    const { join } = await import("path");
    const fs = await import("fs");
    const execPromise = promisify(exec);

    const idData = stripDataUrl(idImageBase64);
    const selfieData = stripDataUrl(selfieImageBase64);
    const tempDir =
      process.env.VERCEL === "1"
        ? join("/tmp", "identity-temp")
        : join(process.cwd(), "uploads", "temp");
    if (!fs.existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const idTempPath = join(tempDir, `id_${stamp}.jpg`);
    const selfieTempPath = join(tempDir, `selfie_${stamp}.jpg`);

    await writeFile(idTempPath, Buffer.from(idData.data, "base64"));
    await writeFile(selfieTempPath, Buffer.from(selfieData.data, "base64"));

    const pythonScriptPath = join(process.cwd(), "faceproj", "compare_images.py");
    const cmd = `python "${pythonScriptPath}" "${idTempPath}" "${selfieTempPath}"`;
    const { stdout } = await execPromise(cmd, { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });

    try {
      await unlink(idTempPath);
      await unlink(selfieTempPath);
    } catch {
      // ignore cleanup
    }

    const parsed = parseJsonFromModel(stdout);
    return {
      matched:
        typeof parsed.matched === "boolean"
          ? parsed.matched
          : Number(parsed.confidence) >= 70,
      confidence:
        typeof parsed.confidence === "number"
          ? parsed.confidence
          : parseInt(String(parsed.confidence), 10) || 0,
      reason: parsed.reason || "Local FaceNet match complete.",
    };
  } catch (err) {
    console.warn("Local FaceNet unavailable, using face-api descriptors when provided:", err);
    return null;
  }
}

/**
 * Face-only check (legacy helpers). Prefer verifyCandidateIdentity for production gates.
 */
export async function verifyFaceBiometricsOnly(
  idImageBase64: string,
  selfieImageBase64: string
): Promise<{ matched: boolean; confidence: number; reason: string }> {
  try {
    const localFace = await runLocalFaceNet(idImageBase64, selfieImageBase64);
    if (localFace) return localFace;
    throw new Error("No biometric engine available (local FaceNet or browser face-api).");
  } catch (err: any) {
    throw new Error(err?.message || "Face biometric verification failed");
  }
}

/**
 * Full production verification: the face on the card must match the selfie.
 * Hosted path: pass browser face-api descriptors (`idDescriptor` + `selfieDescriptor`)
 * when FaceNet is unavailable.
 */
export async function verifyCandidateIdentity(input: {
  idImageBase64: string;
  selfieImageBase64: string;
  selectedIdType?: string | null;
  idDescriptor?: number[] | null;
  selfieDescriptor?: number[] | null;
}): Promise<IdentityVerificationResult> {
  if (!isGovernmentIdType(input.selectedIdType)) {
    return {
      matched: false,
      confidence: 0,
      reason: "Please select a government ID type before verification.",
      selectedIdType: null,
      detectedIdType: null,
      idTypeMatched: false,
      faceMatched: false,
      failureCode: "invalid_id_type",
      engine: "none",
    };
  }

  const selectedIdType = input.selectedIdType;
  const hasFaceApiDescriptors =
    isFaceDescriptor(input.idDescriptor) && isFaceDescriptor(input.selfieDescriptor);
  const faceApiMatch = hasFaceApiDescriptors
    ? matchFaceDescriptors(input.idDescriptor!, input.selfieDescriptor!)
    : null;

  // Production primary: always-on FaceNet service (Render). Runs every verification.
  const remoteFace = await runRemoteFaceNetService(
    input.idImageBase64,
    input.selfieImageBase64
  );

  const localFace =
    remoteFace == null
      ? await runLocalFaceNet(input.idImageBase64, input.selfieImageBase64)
      : null;

  const facenetFace = remoteFace || localFace;
  const facenetEngine: IdentityVerificationResult["engine"] = remoteFace
    ? "facenet"
    : localFace
      ? "facenet"
      : "none";

  // --- Path A: FaceNet service (or local) available — production biometric gate ---
  if (facenetFace) {
    if (facenetFace.failureCode === "no_face_on_id" || facenetFace.failureCode === "no_face_on_selfie") {
      return {
        matched: false,
        confidence: facenetFace.confidence,
        reason: facenetFace.reason,
        selectedIdType,
        detectedIdType: selectedIdType,
        idTypeMatched: true,
        faceMatched: false,
        failureCode: facenetFace.failureCode,
        engine: facenetEngine,
      };
    }

    const MIN_CONFIDENCE = Number(process.env.IDENTITY_MIN_CONFIDENCE || 70);
    let faceMatched = facenetFace.matched;
    let confidence = facenetFace.confidence;
    if (faceApiMatch && faceMatched && faceApiMatch.matched) {
      confidence = Math.round(confidence * 0.85 + faceApiMatch.confidence * 0.15);
    }
    if (faceMatched && confidence < MIN_CONFIDENCE) {
      faceMatched = false;
    }

    if (!faceMatched) {
      return {
        matched: false,
        confidence,
        reason: facenetFace.reason,
        selectedIdType,
        detectedIdType: selectedIdType,
        idTypeMatched: true,
        faceMatched: false,
        failureCode: "face_mismatch",
        engine: facenetEngine,
      };
    }

    return {
      matched: true,
      confidence,
      reason: `${getIdTypeLabel(selectedIdType)} accepted. ${facenetFace.reason}`,
      selectedIdType,
      detectedIdType: selectedIdType,
      idTypeMatched: true,
      faceMatched: true,
      engine: facenetEngine,
    };
  }

  // --- Path B: No FaceNet — browser face-api fallback ---
  if (faceApiMatch) {
    const MIN_CONFIDENCE = Number(process.env.IDENTITY_MIN_CONFIDENCE || 70);
    let faceMatched = faceApiMatch.matched;
    let confidence = faceApiMatch.confidence;
    if (faceMatched && confidence < MIN_CONFIDENCE) {
      faceMatched = false;
    }
    if (!faceMatched) {
      return {
        matched: false,
        confidence,
        reason: faceApiMatch.reason,
        selectedIdType,
        detectedIdType: selectedIdType,
        idTypeMatched: true,
        faceMatched: false,
        failureCode: "face_mismatch",
        engine: "faceapi",
      };
    }
    return {
      matched: true,
      confidence,
      reason: `${getIdTypeLabel(selectedIdType)} accepted (selected by candidate). ${faceApiMatch.reason}`,
      selectedIdType,
      detectedIdType: selectedIdType,
      idTypeMatched: true,
      faceMatched: true,
      engine: "faceapi",
    };
  }

  return {
    matched: false,
    confidence: 0,
    reason:
      "Identity verification engine unavailable. Configure FACE_MATCH_SERVICE_URL (Render FaceNet) for production. Images saved for manual audit.",
    selectedIdType,
    detectedIdType: null,
    idTypeMatched: false,
    faceMatched: false,
    failureCode: "engine_error",
    engine: "none",
    isSystemError: true,
  };
}
