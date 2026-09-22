import type { Metadata } from "next";
import HttpErrorScreen from "@/components/http-error-screen";
import { getHttpError, HTTP_ERROR_CODES, parseHttpErrorCode } from "@/lib/http-error-catalog";
import { APP_NAME } from "@/lib/brand";

type StatusPageProps = {
  params: Promise<{ code: string }>;
};

export function generateStaticParams() {
  return HTTP_ERROR_CODES.map((code) => ({ code: String(code) }));
}

export async function generateMetadata({ params }: StatusPageProps): Promise<Metadata> {
  const { code } = await params;
  const info = getHttpError(parseHttpErrorCode(code));
  return {
    title: `${info.code} ${info.title} · ${APP_NAME}`,
    robots: { index: false, follow: false },
  };
}

export default async function StatusCodePage({ params }: StatusPageProps) {
  const { code } = await params;
  return <HttpErrorScreen code={parseHttpErrorCode(code)} />;
}
