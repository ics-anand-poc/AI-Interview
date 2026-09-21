import type { Metadata } from "next";
import HttpErrorScreen from "@/components/http-error-screen";

export const metadata: Metadata = {
  title: "Sign in required · Interviewscore",
  robots: { index: false, follow: false },
};

export default function UnauthorizedPage() {
  return <HttpErrorScreen code={401} />;
}
