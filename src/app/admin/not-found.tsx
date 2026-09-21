import HttpErrorScreen from "@/components/http-error-screen";

export default function AdminNotFoundPage() {
  return <HttpErrorScreen code={404} />;
}
