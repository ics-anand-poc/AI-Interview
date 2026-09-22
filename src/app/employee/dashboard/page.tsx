"use client";

import dynamic from "next/dynamic";
import { CenteredPageLoading } from "@/components/ui/skeleton";

const DashboardInner = dynamic(
  () => import("./DashboardInner").then((m) => m.DashboardInner),
  {
    ssr: false,
    loading: () => <CenteredPageLoading label="Loading dashboard" />,
  }
);

export default function EmployeeDashboardPage() {
  return <DashboardInner />;
}
