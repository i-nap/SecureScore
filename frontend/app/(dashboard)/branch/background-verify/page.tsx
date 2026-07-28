"use client";

import { useState, useEffect, useCallback } from "react";
import { branchVerifyResults, type VerifyResult } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, Spinner, EmptyState, Badge, StatCard } from "@/components/ui";
import { ShieldCheck, Clock, RefreshCw } from "lucide-react";

function statusVariant(s: string): "success" | "warning" | "info" | "default" {
  if (s === "VERIFIED") return "success";
  if (s === "PENDING") return "warning";
  if (s === "REVERIFICATION_QUEUED") return "info";
  return "default";
}

export default function BackgroundVerifyPage() {
  const { user } = useAuth();
  const [data, setData] = useState<{ results: VerifyResult[]; total: number; pending: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    branchVerifyResults(user?.branch_id ?? "", 50)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user?.branch_id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="flex justify-center p-12"><Spinner /></div>;
  if (error) return <div className="text-red-400 p-6">{error}</div>;
  if (!data || data.results.length === 0)
    return <EmptyState message="No immediate-approval decisions awaiting HQ re-verification yet." />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label="Decisions tracked" value={data.total} icon={<ShieldCheck size={18} />} />
        <StatCard label="Awaiting HQ" value={data.pending} icon={<Clock size={18} />} color="amber" />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-200">Background Re-Verification</h2>
          <button onClick={load} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-800">
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Immediate</th>
                <th className="py-2 pr-4">Local %</th>
                <th className="py-2 pr-4">HQ %</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r, i) => (
                <tr key={`${r.customer_id}-${i}`} className="border-b border-gray-900">
                  <td className="py-2 pr-4 font-mono text-xs">{r.customer_id}</td>
                  <td className="py-2 pr-4">{r.immediate_decision ?? "—"}</td>
                  <td className="py-2 pr-4">{r.immediate_percentile?.toFixed(1) ?? "—"}</td>
                  <td className="py-2 pr-4">{r.hq_percentile?.toFixed(1) ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={statusVariant(r.verification_status)}>{r.verification_status}</Badge>
                  </td>
                  <td className="py-2 text-xs text-gray-400">
                    {r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
