import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton rounded-md", className)} {...props} />;
}

export type ScreeningSkeletonVariant =
  | "requirements"
  | "corp-pool"
  | "portal"
  | "table";

const ROW_WIDTHS = [
  ["w-4", "w-24", "w-2/5", "w-28", "w-16", "w-20"],
  ["w-4", "w-32", "w-1/3", "w-36", "w-14", "w-24"],
  ["w-4", "w-28", "w-2/5", "w-24", "w-20", "w-16"],
  ["w-4", "w-36", "w-1/4", "w-32", "w-12", "w-20"],
  ["w-4", "w-20", "w-1/3", "w-28", "w-16", "w-24"],
  ["w-4", "w-40", "w-2/5", "w-20", "w-14", "w-16"],
  ["w-4", "w-24", "w-1/4", "w-36", "w-20", "w-20"],
  ["w-4", "w-32", "w-1/3", "w-24", "w-12", "w-24"],
] as const;

function FilterBar() {
  return (
    <div className="flex flex-col xl:flex-row gap-3 justify-between items-stretch xl:items-center">
      <Skeleton className="h-9 w-full xl:flex-1 rounded-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full xl:w-auto xl:min-w-[24rem]">
        <Skeleton className="h-9 w-full rounded-xl" />
        <Skeleton className="h-9 w-full rounded-xl" />
      </div>
    </div>
  );
}

function MetricCards() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="p-3 bg-slate-50 dark:bg-slate-900 border border-border rounded-2xl shadow-sm flex flex-col items-center gap-2 min-h-[70px]"
        >
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-7 w-12" />
        </div>
      ))}
    </div>
  );
}

function DateGroupBone() {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-slate-50/80 dark:bg-slate-950/50">
      <Skeleton className="h-3.5 w-3.5 rounded" />
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-3 w-10" />
    </div>
  );
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-3 bg-slate-100/90 dark:bg-slate-950/90 border-b border-border">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-2.5 w-20 hidden sm:block" />
        <Skeleton className="h-2.5 w-16 hidden md:block" />
        <Skeleton className="h-2.5 w-14 ml-auto" />
      </div>
      <DateGroupBone />
      <div className="divide-y divide-indigo-50/50 dark:divide-slate-800/50">
        {ROW_WIDTHS.slice(0, rows).map((cols, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-3.5">
            {cols.map((width, j) => (
              <Skeleton
                key={j}
                className={cn("h-3.5", width, j >= 4 && "hidden md:block")}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function PageLoadingSkeleton({
  label = "Loading",
  variant = "page",
  className,
}: {
  label?: string;
  variant?: "page" | "panel" | "cards";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "skeleton-screen w-full space-y-5",
        variant === "page" && "max-w-3xl mx-auto p-6",
        className
      )}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      {variant === "cards" ? (
        <>
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-2xl" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-border p-4 space-y-3">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ))}
          </div>
        </>
      ) : variant === "panel" ? (
        <>
          <div className="flex gap-3">
            <Skeleton className="h-9 flex-1 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
          <TableSkeleton rows={6} />
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-2xl" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-4/5 rounded-xl" />
          </div>
        </>
      )}
    </div>
  );
}

export function CenteredPageLoading({
  label = "Loading",
  variant = "page",
  className,
}: {
  label?: string;
  variant?: "page" | "panel" | "cards";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-screen bg-background flex items-center justify-center px-4 py-10",
        className
      )}
    >
      <PageLoadingSkeleton label={label} variant={variant} className="w-full" />
    </div>
  );
}

export function ScreeningTableSkeleton({
  variant = "table",
  className,
}: {
  variant?: ScreeningSkeletonVariant;
  className?: string;
}) {
  const label =
    variant === "requirements"
      ? "Loading requirements"
      : variant === "corp-pool"
        ? "Loading Corp Pool"
        : variant === "portal"
          ? "Loading employee portal"
          : "Loading";

  return (
    <div
      className={cn("skeleton-screen space-y-4", className)}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      {variant === "corp-pool" && <MetricCards />}
      {(variant === "requirements" || variant === "corp-pool" || variant === "portal") && (
        <FilterBar />
      )}
      <TableSkeleton />
    </div>
  );
}
