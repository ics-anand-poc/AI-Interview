/** Max size for a government ID photo upload (file on disk, before compress). */
export const ID_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const ID_UPLOAD_MAX_LABEL = "2 MB";

export function formatFileMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const GOVERNMENT_ID_TYPES = [
  { value: "aadhaar", label: "Aadhar Card" },
  { value: "driving_license", label: "Driving License" },
  { value: "pan", label: "PAN Card" },
  { value: "voter_id", label: "Voter ID" },
] as const;

export type GovernmentIdType = (typeof GOVERNMENT_ID_TYPES)[number]["value"];

export type VerificationFailureCode =
  | "missing_id_type"
  | "invalid_id_type"
  | "id_type_mismatch"
  | "no_face_on_id"
  | "no_face_on_selfie"
  | "face_mismatch"
  | "low_quality"
  | "spoof_suspected"
  | "engine_error";

export function isGovernmentIdType(value: unknown): value is GovernmentIdType {
  return (
    typeof value === "string" &&
    GOVERNMENT_ID_TYPES.some((t) => t.value === value)
  );
}

export function getIdTypeLabel(value: string | null | undefined): string {
  const found = GOVERNMENT_ID_TYPES.find((t) => t.value === value);
  return found?.label || value || "Unknown";
}

/** Candidate-facing copy. Never mention distance, confidence, or engine names. */
export function candidateIdentityCopy(input: {
  matched?: boolean;
  failureCode?: VerificationFailureCode | string | null;
  selectedIdType?: string | null;
}): string {
  if (input.matched) {
    const label = getIdTypeLabel(input.selectedIdType);
    return label && label !== "Unknown"
      ? `${label} matched your live photo. You can continue.`
      : "Your ID matched your live photo. You can continue.";
  }
  switch (input.failureCode) {
    case "no_face_on_id":
      return "We could not see a clear face on the ID. Upload a sharper photo of the card or take another picture.";
    case "no_face_on_selfie":
      return "We could not see a clear face in the selfie. Look at the camera with good lighting and try again.";
    case "face_mismatch":
      return "The face on the ID does not match the live photo. Use your own ID and look straight at the camera.";
    case "invalid_id_type":
    case "missing_id_type":
      return "Select the type of government ID you are using.";
    case "engine_error":
      return "Identity check is unavailable right now. Your photos were saved for a recruiter to review.";
    default:
      return "We could not verify this ID against the live photo. Try a clearer ID photo or another selfie.";
  }
}

const ID_TYPE_ALIASES: Record<GovernmentIdType, string[]> = {
  aadhaar: ["aadhaar", "aadhar", "uidai", "unique identification"],
  driving_license: [
    "driving_license",
    "driving licence",
    "driver's license",
    "drivers license",
    "driving license",
    "dl card",
    "rto",
  ],
  pan: ["pan", "pan card", "permanent account number", "income tax"],
  voter_id: ["voter_id", "voter id", "voter card", "epic", "election commission", "elector's photo"],
};

export function normalizeDetectedIdType(raw: string | null | undefined): GovernmentIdType | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim().replace(/[^a-z0-9\s_]/g, " ");
  for (const [canonical, aliases] of Object.entries(ID_TYPE_ALIASES) as [
    GovernmentIdType,
    string[],
  ][]) {
    if (aliases.some((a) => cleaned.includes(a) || a.includes(cleaned))) {
      return canonical;
    }
  }
  return null;
}
