"use client";

import HttpErrorScreen from "@/components/http-error-screen";

export default function AppErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <HttpErrorScreen code={500} onRetry={reset} />;
}
