"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { customerScore, customerExplain, type ScoreResult, type XaiResult } from "@/lib/api";
import { Card, StatCard, Badge, Spinner, Button } from "@/components/ui";
import { ShieldCheck, ShieldX, TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export default function CustomerDashboard() {
  const { user } = useAuth();
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [xai, setXai] = useState<XaiResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error] = useState("");

  const customerId = user?.customer_id || user?.username || "";

  useEffect(() => {
    if (!customerId) return;
    setLoading(true);
    Promise.all([
      customerScore(customerId).catch(() => null),
      customerExplain(customerId).catch(() => null),
    ]).then(([s, x]) => {
      setScore(s);
      setXai(x);
      setLoading(false);
    });
  }, [customerId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <div className="text-red-600 text-center py-10">{error}</div>;
  }

  const isCreditworthy = score?.prediction === "creditworthy";
  const prob = score?.probability_creditworthy ?? 0;

  // Prepare SHAP chart data
  const shapData = (xai?.top_factors || []).map((f) => ({
    feature: f.feature.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
    value: parseFloat(f.shap_value.toFixed(4)),
  }));

  const factorTips: Record<string, string> = {
    credit_utilization: "Lower card utilization below 30% to improve stability.",
    debt_to_income_ratio: "Reduce monthly debt or increase income to lower DTI.",
    dti_ratio: "Lower DTI by paying down existing EMIs.",
    monthly_income: "Consistent income deposits strengthen your profile.",
    transaction_count: "Increase regular transactions to build a stronger history.",
    digital_engagement_score: "Use mobile banking and wallets more frequently.",
    total_transaction_volume: "Maintain steady spending instead of spikes.",
    alternative_credit_score: "Keep on-time payments to lift your alternative score.",
  };

  const topDrivers = (xai?.top_factors || []).slice(0, 4).map((f) => ({
    feature: f.feature,
    shap: f.shap_value,
    tip: factorTips[f.feature] || "Maintain consistent behavior and avoid volatility.",
  }));

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-ink">Credit Dashboard</h1>
        <p className="text-sm text-ink-soft mt-1">
          Welcome back, {user?.full_name}. Here&apos;s your credit assessment from the{" "}
          {user?.branch_id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} branch.
        </p>
      </div>

      {/* Score cards */}
      {score ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Credit Status"
              value={isCreditworthy ? "Approved" : "Needs Review"}
              sub={score.prediction}
              icon={isCreditworthy ? <ShieldCheck size={28} className="text-emerald-500" /> : <ShieldX size={28} className="text-red-500" />}
              color={isCreditworthy ? "green" : "red"}
            />
            <StatCard
              label="Creditworthiness"
              value={`${(prob * 100).toFixed(1)}%`}
              sub={score.risk_bucket}
              icon={prob > 0.5 ? <TrendingUp size={28} className="text-emerald-500" /> : <TrendingDown size={28} className="text-red-400" />}
              color={prob > 0.7 ? "green" : prob > 0.4 ? "amber" : "red"}
            />
            <StatCard
              label="Features Analyzed"
              value={score.features_used}
              sub="data points"
              icon={<BarChart3 size={28} className="text-blue-400" />}
              color="blue"
            />
          </div>

          {/* Probability gauge */}
          <Card>
            <h2 className="text-sm font-semibold text-ink mb-3">Score Breakdown</h2>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ${prob > 0.7 ? "bg-emerald-500" : prob > 0.4 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${prob * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-xs text-ink-faint">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
              <Badge variant={isCreditworthy ? "success" : "danger"}>
                {isCreditworthy ? "Creditworthy" : "Not Creditworthy"}
              </Badge>
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <p className="text-sm text-ink-soft text-center py-6">
            Unable to retrieve your credit score. The edge node may be offline.
          </p>
          <div className="flex justify-center">
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </Card>
      )}

      {/* SHAP explanation chart */}
      {xai && shapData.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-1">Why This Decision?</h2>
          <p className="text-xs text-ink-faint mb-4">
            SHAP values show how each factor contributed to your score. Green bars increase your score; red bars decrease it.
          </p>
          <ResponsiveContainer width="100%" height={shapData.length * 40 + 40}>
            <BarChart data={shapData} layout="vertical" margin={{ left: 120, right: 20, top: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis dataKey="feature" type="category" tick={{ fontSize: 11 }} width={120} />
              <Tooltip
                formatter={(value) => [Number(value).toFixed(4), "SHAP Impact"]}
                contentStyle={{ borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {shapData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.value >= 0 ? "#10b981" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Actionable explainability */}
      {topDrivers.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-1">Actionable Insights</h2>
          <p className="text-xs text-ink-faint mb-4">
            Top factors influencing your score with practical next steps.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {topDrivers.map((d, idx) => (
              <div key={`${d.feature}-${idx}`} className="rounded-xl border border-line bg-canvas px-4 py-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink">
                    {d.feature.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </span>
                  <span className={d.shap >= 0 ? "text-red-500" : "text-emerald-600"}>
                    {d.shap >= 0 ? "+" : ""}{d.shap.toFixed(3)}
                  </span>
                </div>
                <p className="text-xs text-ink-soft mt-1">{d.tip}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
