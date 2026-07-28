"use client";

import { useEffect, useState } from "react";
import { branchCustomers, branchExplain, type BranchCustomerList, type XaiResult } from "@/lib/api";
import { Card, Badge, Spinner, Button } from "@/components/ui";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
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

export default function BranchCustomersPage() {
  const [data, setData] = useState<BranchCustomerList | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // XAI panel
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [xai, setXai] = useState<XaiResult | null>(null);
  const [xaiLoading, setXaiLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    branchCustomers(page, 25)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  const openXai = async (customerId: string) => {
    setSelectedId(customerId);
    setXaiLoading(true);
    try {
      const res = await branchExplain(customerId);
      setXai(res);
    } catch {
      setXai(null);
    } finally {
      setXaiLoading(false);
    }
  };

  const shapData = (xai?.top_factors || []).map((f) => ({
    feature: f.feature.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
    value: parseFloat(f.shap_value.toFixed(4)),
  }));

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  const totalPages = data ? Math.ceil(data.total / data.per_page) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Customer List</h1>
        <p className="text-sm text-ink-soft mt-1">
          {data?.total ?? 0} customers &middot; Click a row to view XAI explanation
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Table */}
        <div className="lg:col-span-2">
          <Card className="!p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs font-medium text-ink-soft uppercase tracking-wide">
                  <th className="px-4 py-3">Customer ID</th>
                  <th className="px-4 py-3">Prediction</th>
                  <th className="px-4 py-3">Probability</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data?.customers || []).map((c) => (
                  <tr
                    key={c.customer_id}
                    className={`hover:bg-teal-soft cursor-pointer transition-colors ${
                      selectedId === c.customer_id ? "bg-teal-soft" : ""
                    }`}
                    onClick={() => openXai(c.customer_id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{c.customer_id}</td>
                    <td className="px-4 py-3">
                      <Badge variant={c.prediction === "creditworthy" ? "success" : "danger"}>
                        {c.prediction}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">{(c.probability * 100).toFixed(1)}%</td>
                    <td className="px-4 py-3">
                      <button className="text-teal hover:text-blue-800 text-xs font-medium">
                        <Search size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t bg-canvas">
              <span className="text-xs text-ink-soft">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  <ChevronLeft size={14} /> Prev
                </Button>
                <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  Next <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* XAI side panel */}
        <div>
          {selectedId ? (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-ink">
                  XAI: {selectedId}
                </h2>
                <button onClick={() => { setSelectedId(null); setXai(null); }}>
                  <X size={16} className="text-ink-faint hover:text-ink-soft" />
                </button>
              </div>

              {xaiLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner />
                </div>
              ) : xai ? (
                <>
                  <div className="mb-3 space-y-1">
                    <p className="text-sm">
                      Prediction:{" "}
                      <Badge variant={xai.prediction === "creditworthy" ? "success" : "danger"}>
                        {xai.prediction}
                      </Badge>
                    </p>
                    <p className="text-sm text-ink-soft">
                      Probability: {(xai.probability_creditworthy * 100).toFixed(1)}%
                    </p>
                  </div>

                  <p className="text-xs text-ink-faint mb-2">SHAP Feature Importance</p>
                  <ResponsiveContainer width="100%" height={shapData.length * 32 + 20}>
                    <BarChart data={shapData} layout="vertical" margin={{ left: 90, right: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="feature" type="category" tick={{ fontSize: 10 }} width={90} />
                      <Tooltip formatter={(v) => [Number(v).toFixed(4), "SHAP"]} contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                      <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                        {shapData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.value >= 0 ? "#10b981" : "#ef4444"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </>
              ) : (
                <p className="text-sm text-ink-faint text-center py-6">No XAI data available.</p>
              )}
            </Card>
          ) : (
            <Card>
              <div className="text-center py-10 text-ink-faint">
                <Search size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Click a customer row to view their SHAP explanation</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
