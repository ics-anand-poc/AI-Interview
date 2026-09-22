/**
 * Open interview camera without failing the whole start if the mic is missing.
 * getUserMedia({ video, audio }) throws NotFoundError when either device is absent.
 */

export type InterviewMedia = {
  stream: MediaStream;
  hasVideo: boolean;
  hasAudio: boolean;
};

const VIDEO: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  facingMode: "user",
};

const AUDIO: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
};

function mediaError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

export async function acquireInterviewMedia(): Promise<InterviewMedia> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: AUDIO });
    return { stream, hasVideo: true, hasAudio: true };
  } catch (bothErr: unknown) {
    const bothName = (bothErr as { name?: string })?.name || "";
    if (bothName === "NotAllowedError" || bothName === "PermissionDeniedError") {
      throw mediaError(
        bothName,
        "Camera permission denied. Allow camera in the browser address bar and try again."
      );
    }
    if (bothName === "NotReadableError") {
      throw mediaError(
        bothName,
        "Camera is in use by another app (Teams, Zoom, or another tab). Close it and try again."
      );
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO });
    return { stream, hasVideo: true, hasAudio: false };
  } catch (videoErr: unknown) {
    const name = (videoErr as { name?: string })?.name || "NotFoundError";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw mediaError(
        name,
        "Camera permission denied. Allow camera in the browser address bar and try again."
      );
    }
    if (name === "NotReadableError") {
      throw mediaError(
        name,
        "Camera is in use by another app (Teams, Zoom, or another tab). Close it and try again."
      );
    }
    throw mediaError(
      name,
      "No camera found. Use Chrome or Edge on this PC (not an in-app preview), plug in a webcam, and close other apps using it. Live ID matching needs a camera."
    );
  }
}
