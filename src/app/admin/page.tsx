"use client";

import dynamic from "next/dynamic";
import { CenteredPageLoading } from "@/components/ui/skeleton";

const AdminDashboard = dynamic(() => import("./AdminDashboard"), {
  ssr: false,
  loading: () => <CenteredPageLoading label="Loading admin console" />,
});

export default function AdminPage() {
  return <AdminDashboard />;
}
