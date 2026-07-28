"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { branchMetrics, type BranchMetrics } from "@/lib/api";
import { Card, StatCard, Spinner, Badge } from "@/components/ui";
import { Users, CheckCircle, TrendingUp, BarChart3 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function BranchDashboard() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<BranchMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    branchMetrics()
      .then(setMetrics)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <Card>
        <p className="text-sm text-ink-soft text-center py-10">
          Unable to connect to the {user?.branch_id} edge node. Make sure edge_api.py is running.
        </p>
      </Card>
    );
  }

  // Prepare demographic chart data
  const demoData = metrics.demographic_breakdown
    ? Object.entries(metrics.demographic_breakdown).map(([key, val]) => ({
        category: key.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        count: typeof val === "number" ? val : 0,
      }))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Branch Overview</h1>
          <p className="text-sm text-ink-soft mt-1">
            {user?.branch_id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} Branch &middot;{" "}
            <Badge variant={metrics.branch_type === "urban" ? "success" : metrics.branch_type === "rural" ? "warning" : "default"}>
              {metrics.branch_type}
            </Badge>
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Customers"
          value={(metrics.total_customers ?? 0).toLocaleString()}
          icon={<Users size={24} />}
          color="blue"
        />
        <StatCard
          label="Model Accuracy"
          value={`${((metrics.model_accuracy ?? 0) * 100).toFixed(1)}%`}
          icon={<CheckCircle size={24} />}
          color={(metrics.model_accuracy ?? 0) > 0.85 ? "green" : "amber"}
        />
        <StatCard
          label="Approval Rate"
          value={`${((metrics.approval_rate ?? 0) * 100).toFixed(1)}%`}
          icon={<TrendingUp size={24} />}
          color="purple"
        />
        <StatCard
          label="Avg. Probability"
          value={`${((metrics.avg_probability ?? 0) * 100).toFixed(1)}%`}
          icon={<BarChart3 size={24} />}
          color="amber"
        />
      </div>

      {/* Demographic breakdown */}
      {demoData.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-4">Demographic Breakdown</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={demoData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="category" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}
