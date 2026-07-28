"use client";

import { clsx as cn } from "clsx";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-gray-200",
        className
      )}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-line p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-3 w-48" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4 pb-2 border-b border-line">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center">
          {[1, 2, 3, 4].map((j) => (
            <Skeleton key={j} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="w-full bg-gray-100 rounded-lg animate-pulse flex items-end justify-around px-4 pb-4 pt-8 gap-2"
      style={{ height }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="bg-gray-200 rounded-t flex-1"
          style={{ height: `${20 + Math.random() * 60}%` }}
        />
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-line p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <ChartSkeleton height={250} />
        </div>
        <div className="bg-white rounded-xl border border-line p-6">
          <Skeleton className="h-5 w-40 mb-4" />
          <ChartSkeleton height={250} />
        </div>
      </div>
      {/* Table */}
      <div className="bg-white rounded-xl border border-line p-6">
        <Skeleton className="h-5 w-32 mb-4" />
        <TableSkeleton rows={5} />
      </div>
    </div>
  );
}
