import type { Metadata } from "next";
import HttpErrorScreen from "@/components/http-error-screen";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Sign in required · ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export default function UnauthorizedPage() {
  return <HttpErrorScreen code={401} />;
}
