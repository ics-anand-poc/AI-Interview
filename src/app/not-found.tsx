import type { Metadata } from "next";
import HttpErrorScreen from "@/components/http-error-screen";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Page not found · ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export default function NotFoundPage() {
  return <HttpErrorScreen code={404} />;
}
