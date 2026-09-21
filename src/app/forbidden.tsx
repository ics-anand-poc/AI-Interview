import type { Metadata } from "next";
import HttpErrorScreen from "@/components/http-error-screen";

export const metadata: Metadata = {
  title: "Access denied · Interviewscore",
  robots: { index: false, follow: false },
};

export default function ForbiddenPage() {
  return <HttpErrorScreen code={403} />;
}
