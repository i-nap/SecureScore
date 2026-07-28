"use client";

import { useEffect, useState } from "react";
import { getBranchClients, getBranchBankingSummary, type BranchClient, type BranchBankingSummary } from "@/lib/api";
import { Card, StatCard, Badge, Spinner, Button } from "@/components/ui";
import { Users, Search, ChevronRight } from "lucide-react";

function fmtNPR(n: number) {
  return new Intl.NumberFormat("en-NP", { style: "currency", currency: "NPR", notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function kycBadge(status: string) {
  if (status === "verified") return <Badge variant="success">KYC Verified</Badge>;
  if (status === "rejected") return <Badge variant="danger">KYC Rejected</Badge>;
  return <Badge variant="warning">KYC Pending</Badge>;
}

export default function BranchClientsPage() {
  const [clients, setClients] = useState<BranchClient[]>([]);
  const [summary, setSummary] = useState<BranchBankingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    getBranchBankingSummary().then(setSummary).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getBranchClients({ search: search || undefined, page, per_page: 25 })
      .then(r => setClients(r.clients))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [search, page]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Branch Clients</h1>
        <p className="text-sm text-ink-soft mt-0.5">All customers with accounts at this branch</p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Accounts" value={String(summary.total_accounts)} />
          <StatCard label="Total Balance" value={fmtNPR(summary.total_balance_npr)} color="violet" />
          <StatCard label="Dormant Accounts" value={String(summary.dormant_accounts)} color="red" />
          <StatCard label="Pending Applications" value={String(summary.pending_applications)} color="amber" />
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
        <input
          type="text"
          placeholder="Search by name, customer ID, or national ID..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
        />
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : clients.length === 0 ? (
        <Card>
          <div className="text-center py-10">
            <Users size={36} className="text-gray-300 mx-auto mb-2" />
            <p className="text-ink-faint">{search ? "No clients match your search." : "No clients found."}</p>
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-0 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-canvas border-b border-line">
                  <th className="py-3 px-4 text-left text-xs font-medium text-ink-soft uppercase">Client</th>
                  <th className="py-3 px-4 text-left text-xs font-medium text-ink-soft uppercase hidden md:table-cell">Occupation</th>
                  <th className="py-3 px-4 text-center text-xs font-medium text-ink-soft uppercase">KYC</th>
                  <th className="py-3 px-4 text-right text-xs font-medium text-ink-soft uppercase">Accounts</th>
                  <th className="py-3 px-4 text-right text-xs font-medium text-ink-soft uppercase">Total Balance</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clients.map(cl => (
                  <tr key={cl.customer_id} className="hover:bg-canvas transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-ink text-sm">{cl.full_name}</p>
                      <p className="text-xs text-ink-faint font-mono">{cl.customer_id}</p>
                      {cl.national_id && <p className="text-xs text-ink-faint">NID: {cl.national_id}</p>}
                    </td>
                    <td className="py-3 px-4 text-sm text-ink-soft hidden md:table-cell">{cl.occupation || "--"}</td>
                    <td className="py-3 px-4 text-center">{kycBadge(cl.kyc_status)}</td>
                    <td className="py-3 px-4 text-right text-sm font-medium text-ink">{cl.account_count}</td>
                    <td className="py-3 px-4 text-right text-sm font-bold text-ink">{fmtNPR(cl.total_balance)}</td>
                    <td className="py-3 px-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.location.href = `/branch/clients/${cl.customer_id}`}
                      >
                        <ChevronRight size={14} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-faint">{clients.length} clients shown</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={clients.length < 25}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
