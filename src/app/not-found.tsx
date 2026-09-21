import type { Metadata } from "next";
import HttpErrorScreen from "@/components/http-error-screen";

export const metadata: Metadata = {
  title: "Page not found · Interviewscore",
  robots: { index: false, follow: false },
};

export default function NotFoundPage() {
  return <HttpErrorScreen code={404} />;
}
