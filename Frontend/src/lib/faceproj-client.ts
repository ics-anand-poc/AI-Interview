import { postJson } from "@/lib/local-http";

export type MonitorState = "one" | "none" | "multiple" | "phone" | "left" | "right" | "up" | "down";

export interface MonitorResult {
  state: MonitorState;
  personCount: number;
  phoneDetected: boolean;
}

export async function monitorFrame(frame: string): Promise<MonitorResult> {
  const serviceUrl = process.env.FACEPROJ_SERVICE_URL || "http://127.0.0.1:8000";
  const apiKey = process.env.FACE_MATCH_KEY;

  return postJson<MonitorResult>(
    `${serviceUrl}/monitor`,
    { frame },
    apiKey ? { "X-Face-Match-Key": apiKey } : {}
  );
}
