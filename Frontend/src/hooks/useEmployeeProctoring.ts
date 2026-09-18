"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPLOYEE_PROCTOR_MAX_VIOLATIONS,
  EMPLOYEE_PROCTOR_VIOLATION_COOLDOWN_MS,
  type EmployeeProctoringState,
} from "@/lib/employee-proctoring";
import { BACKEND_URL } from "@/lib/backend-client";

export function isFullscreenActive(): boolean {
  if (typeof document === "undefined") return false;
  return !!(
    document.fullscreenElement ||
    (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ||
    (document as Document & { mozFullScreenElement?: Element }).mozFullScreenElement
  );
}

const BLOCKED_DEVTOOLS =
  /^(F12|F5|F11)$/i;

type ProctorPhase = "loading" | "ready" | "running" | "retake-confirm" | "submitted" | "error";

export function useEmployeeProctoring(options: {
  testId: string;
  token: string;
  phase: ProctorPhase;
  answersRef: React.MutableRefObject<Record<number, number>>;
  onAutoSubmit: (answers: Record<number, number>) => void;
  requestFullscreen: () => Promise<void>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  camStream: MediaStream | null;
  mediaRecorderRef: React.MutableRefObject<MediaRecorder | null>;
  initialProctoring?: EmployeeProctoringState | null;
  intentionalRecorderStopRef: React.MutableRefObject<boolean>;
}) {
  const {
    testId,
    token,
    phase,
    answersRef,
    onAutoSubmit,
    requestFullscreen,
    videoRef,
    camStream,
    mediaRecorderRef,
    initialProctoring,
    intentionalRecorderStopRef,
  } = options;

  const [warningCount, setWarningCount] = useState(initialProctoring?.warningCount ?? 0);
  const [showProctorWarning, setShowProctorWarning] = useState<string | null>(null);
  const lastTriggerRef = useRef<Record<string, number>>({});
  const autoSubmitTriggeredRef = useRef(false);
  const onAutoSubmitRef = useRef(onAutoSubmit);
  onAutoSubmitRef.current = onAutoSubmit;

  useEffect(() => {
    if (initialProctoring?.warningCount != null) {
      setWarningCount(initialProctoring.warningCount);
    }
  }, [initialProctoring?.warningCount]);

  const persistProctorViolation = useCallback(
    async (violationType: string) => {
      if (!token) return null;
      try {
        const res = await fetch(`/api/employee/tests/${testId}/proctor_violation`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ violationType }),
        });
        if (!res.ok) return null;
        const payload = await res.json();
        return payload.proctoring as EmployeeProctoringState;
      } catch (err) {
        console.warn("Failed to persist proctor violation:", err);
        return null;
      }
    },
    [testId, token]
  );

  const violationMessage = useCallback((violationType: string, count: number) => {
    if (count >= EMPLOYEE_PROCTOR_MAX_VIOLATIONS) {
      return "You have exceeded the maximum of 3 security violations. Your assessment is being automatically submitted.";
    }
    const messages: Record<string, string> = {
      "Tab Switch Detected": "You switched browser tabs or minimized the window. This is prohibited during the test.",
      "Window Lost Focus": "You left the test window or opened another application.",
      "Page Navigation Attempt": "Leaving this page during the test is not allowed.",
      "Right Click Attempted": "Right-clicking and context menus are disabled during the test.",
      "DevTools Shortcut Blocked": "Developer tools and view-source shortcuts are blocked.",
      "Copy/Paste Attempted": "Copying, cutting, or pasting text is disabled during the test.",
      "Fullscreen Mode Exited": "You exited fullscreen mode. You must remain in fullscreen for the entire test.",
      "Camera Disabled": "Your camera was turned off or disconnected. Camera must remain active.",
      "Camera Track Lost": "Camera feed lost. Please keep your camera enabled and visible.",
      "Recording Interrupted": "Session recording stopped unexpectedly. Do not disable camera or close the browser.",
      "Face Missing": "Face not detected in camera feed. Please face your screen clearly.",
      "Looking Away": "Please look directly at your screen.",
      "Looking Down (possible phone usage)": "Please look at your screen — looking down is flagged as a violation.",
      "Multiple Faces Detected": "Multiple faces detected. Only the test taker may be visible.",
      "Print Attempt Blocked": "Printing the test page is not allowed.",
      "Refresh Attempt Blocked": "Refreshing the page during the test is not allowed.",
    };
    return messages[violationType] ?? `Security violation flagged: ${violationType}.`;
  }, []);

  const triggerProctorWarning = useCallback(
    (violationType: string) => {
      if (phase !== "running") return;
      if (autoSubmitTriggeredRef.current) return;

      const nowMs = Date.now();
      const lastForType = lastTriggerRef.current[violationType] ?? 0;
      if (nowMs - lastForType < EMPLOYEE_PROCTOR_VIOLATION_COOLDOWN_MS) return;
      lastTriggerRef.current[violationType] = nowMs;

      void (async () => {
        const serverState = await persistProctorViolation(violationType);
        const nextCount = serverState?.warningCount ?? Math.min(warningCount + 1, EMPLOYEE_PROCTOR_MAX_VIOLATIONS);
        setWarningCount(nextCount);

        const msgText = violationMessage(violationType, nextCount);
        setShowProctorWarning(msgText);

        if (nextCount >= EMPLOYEE_PROCTOR_MAX_VIOLATIONS && !autoSubmitTriggeredRef.current) {
          autoSubmitTriggeredRef.current = true;
          setTimeout(() => {
            setShowProctorWarning(null);
            onAutoSubmitRef.current(answersRef.current);
          }, 1800);
        }
      })();
    },
    [phase, persistProctorViolation, violationMessage, warningCount, answersRef]
  );

  const dismissWarning = useCallback(async () => {
    setShowProctorWarning(null);
    await requestFullscreen();
    if (!isFullscreenActive()) {
      triggerProctorWarning("Fullscreen Mode Exited");
    }
  }, [requestFullscreen, triggerProctorWarning]);

  // ── Browser integrity listeners ───────────────────────────────
  useEffect(() => {
    if (phase !== "running") return;

    let blurVisibilityTimer: ReturnType<typeof setTimeout> | null = null;
    let focusViolationPending = false;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        focusViolationPending = true;
        if (blurVisibilityTimer) clearTimeout(blurVisibilityTimer);
        blurVisibilityTimer = setTimeout(() => {
          if (document.visibilityState === "hidden") {
            triggerProctorWarning("Tab Switch Detected");
          }
          focusViolationPending = false;
        }, 400);
      } else if (focusViolationPending) {
        focusViolationPending = false;
        if (blurVisibilityTimer) clearTimeout(blurVisibilityTimer);
      }
    };

    const handleWindowBlur = () => {
      if (document.visibilityState === "visible") {
        if (blurVisibilityTimer) clearTimeout(blurVisibilityTimer);
        blurVisibilityTimer = setTimeout(() => {
          if (!document.hasFocus()) {
            triggerProctorWarning("Window Lost Focus");
          }
        }, 400);
      }
    };

    const handlePageHide = () => {
      triggerProctorWarning("Page Navigation Attempt");
    };

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Your test is in progress. Leaving will record a proctoring violation.";
      triggerProctorWarning("Page Navigation Attempt");
      return e.returnValue;
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      triggerProctorWarning("Right Click Attempted");
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (BLOCKED_DEVTOOLS.test(key)) {
        e.preventDefault();
        e.stopPropagation();
        triggerProctorWarning(key.toUpperCase() === "F5" ? "Refresh Attempt Blocked" : "DevTools Shortcut Blocked");
        return;
      }

      const isDevToolsShortcut =
        (isCmdOrCtrl && isShift && /[ijcJIC]/.test(key)) ||
        (isCmdOrCtrl && /[uswtpUSWTP]/.test(key)) ||
        key === "PrintScreen";

      if (isDevToolsShortcut) {
        e.preventDefault();
        e.stopPropagation();
        triggerProctorWarning(
          key === "PrintScreen" || (isCmdOrCtrl && /[pP]/.test(key))
            ? "Print Attempt Blocked"
            : "DevTools Shortcut Blocked"
        );
      }
    };

    const handleCopyCutPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      triggerProctorWarning("Copy/Paste Attempted");
    };

    const handleSelectStart = (e: Event) => {
      e.preventDefault();
    };

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleFullscreenChange = () => {
      if (!isFullscreenActive()) {
        triggerProctorWarning("Fullscreen Mode Exited");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("copy", handleCopyCutPaste);
    document.addEventListener("cut", handleCopyCutPaste);
    document.addEventListener("paste", handleCopyCutPaste);
    document.addEventListener("selectstart", handleSelectStart);
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);

    return () => {
      if (blurVisibilityTimer) clearTimeout(blurVisibilityTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("copy", handleCopyCutPaste);
      document.removeEventListener("cut", handleCopyCutPaste);
      document.removeEventListener("paste", handleCopyCutPaste);
      document.removeEventListener("selectstart", handleSelectStart);
      document.removeEventListener("dragstart", handleDragStart);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
    };
  }, [phase, triggerProctorWarning]);

  // ── Fullscreen watchdog ─────────────────────────────────────────
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => {
      if (!isFullscreenActive()) {
        triggerProctorWarning("Fullscreen Mode Exited");
        void requestFullscreen();
      }
      if (!document.hasFocus() && document.visibilityState === "visible") {
        triggerProctorWarning("Window Lost Focus");
      }
    }, 3000);
    return () => clearInterval(id);
  }, [phase, triggerProctorWarning, requestFullscreen]);

  // ── Camera + recorder integrity ───────────────────────────────
  useEffect(() => {
    if (phase !== "running" || !camStream) return;

    const onTrackEnded = () => {
      triggerProctorWarning("Camera Track Lost");
    };

    for (const track of camStream.getVideoTracks()) {
      track.addEventListener("ended", onTrackEnded);
      track.addEventListener("mute", onTrackEnded);
      if (!track.enabled || track.readyState === "ended") {
        triggerProctorWarning("Camera Disabled");
      }
    }

    const recorder = mediaRecorderRef.current;
    const onRecorderStop = () => {
      if (intentionalRecorderStopRef.current) return;
      if (phase === "running" && !autoSubmitTriggeredRef.current) {
        triggerProctorWarning("Recording Interrupted");
      }
    };
    if (recorder) {
      recorder.addEventListener("stop", onRecorderStop);
    }

    const monitorId = setInterval(() => {
      const videoTrack = camStream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState === "ended" || !videoTrack.enabled) {
        triggerProctorWarning("Camera Disabled");
      }
      if (
        !intentionalRecorderStopRef.current &&
        recorder &&
        recorder.state === "inactive" &&
        phase === "running"
      ) {
        triggerProctorWarning("Recording Interrupted");
      }
    }, 5000);

    return () => {
      for (const track of camStream.getVideoTracks()) {
        track.removeEventListener("ended", onTrackEnded);
        track.removeEventListener("mute", onTrackEnded);
      }
      if (recorder) recorder.removeEventListener("stop", onRecorderStop);
      clearInterval(monitorId);
    };
  }, [phase, camStream, mediaRecorderRef, triggerProctorWarning, intentionalRecorderStopRef]);

  // ── Face + gaze tracking (faceproj: YOLO nano + MTCNN) ──────────
  useEffect(() => {
    if (phase !== "running") return;

    type MonitorState = "one" | "none" | "multiple" | "phone" | "left" | "right" | "up" | "down";

    let lastState: MonitorState = "one";
    let stateStartTime = Date.now();
    let inFlight = false;
    let lastKeystrokeAt = 0;
    const stateHistory: MonitorState[] = [];
    const canvas = document.createElement("canvas");

    const handleKeydown = () => {
      lastKeystrokeAt = Date.now();
    };
    window.addEventListener("keydown", handleKeydown);

    const violationForState: Partial<Record<MonitorState, string>> = {
      none: "Face Missing",
      multiple: "Multiple Faces Detected",
      phone: "Looking Down (possible phone usage)",
      left: "Looking Away",
      right: "Looking Away",
      up: "Looking Away",
    };

    const captureFrame = (): string | null => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return null;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.7);
    };

    const intervalId = setInterval(async () => {
      if (inFlight || !token) return;
      const frame = captureFrame();
      if (!frame) return;

      inFlight = true;
      try {
        const res = await fetch(`${BACKEND_URL}/api/employee/tests/${testId}/monitor`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ frame }),
        });
        if (!res.ok) return;
        const { state } = (await res.json()) as { state: MonitorState };

        stateHistory.push(state);
        if (stateHistory.length > 3) stateHistory.shift();

        const counts: Partial<Record<MonitorState, number>> = {};
        let smoothedState = state;
        let maxCount = 0;
        for (const s of stateHistory) {
          counts[s] = (counts[s] || 0) + 1;
          if ((counts[s] as number) > maxCount) {
            maxCount = counts[s] as number;
            smoothedState = s;
          }
        }

        const now = Date.now();
        if (smoothedState !== lastState) {
          lastState = smoothedState;
          stateStartTime = now;
        } else {
          const duration = (now - stateStartTime) / 1000;
          if (lastState === "down") {
            const secondsSinceKeystroke = (now - lastKeystrokeAt) / 1000;
            if (duration >= 3.5 && secondsSinceKeystroke > 5) {
              triggerProctorWarning("Looking Down (possible phone usage)");
              stateStartTime = now;
            }
          } else {
            const violationType = violationForState[lastState];
            if (violationType && duration >= 3.5) {
              triggerProctorWarning(violationType);
              stateStartTime = now;
            }
          }
        }
      } catch (err) {
        console.warn("Monitor frame check failed:", err);
      } finally {
        inFlight = false;
      }
    }, 1500);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [phase, testId, token, triggerProctorWarning, videoRef]);

  return {
    warningCount,
    showProctorWarning,
    dismissWarning,
    triggerProctorWarning,
  };
}
