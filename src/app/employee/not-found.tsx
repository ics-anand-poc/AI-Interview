import HttpErrorScreen from "@/components/http-error-screen";

export default function EmployeeNotFoundPage() {
  return <HttpErrorScreen code={404} />;
}
