"use client";

import "./globals.css";
import HttpErrorScreen from "@/components/http-error-screen";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[rgb(8,11,22)] text-slate-100">
        <HttpErrorScreen code={500} onRetry={reset} />
      </body>
    </html>
  );
}
