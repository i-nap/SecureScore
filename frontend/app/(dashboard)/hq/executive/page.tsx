"use client";

import { useState, useEffect } from "react";
import { ceoOverview, trialBalance, type CEOOverview, type TrialBalance } from "@/lib/api";
import { Card, StatCard, Badge, Spinner } from "@/components/ui";
import { Wallet, Users, Building2, Banknote, PiggyBank, Receipt, Scale } from "lucide-react";

export default function ExecutivePage() {
  const [data, setData] = useState<CEOOverview | null>(null);
  const [tb, setTb] = useState<TrialBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ceoOverview().then(setData).catch((e) => setError(e.message));
    trialBalance().then(setTb).catch(() => {});
  }, []);

  if (error) return <div className="text-danger p-6">{error}</div>;
  if (!data) return <div className="flex justify-center p-12"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total deposits" value={`NPR ${data.total_deposits.toLocaleString()}`} icon={<Wallet size={18} />} color="gold" />
        <StatCard label="FD book" value={`NPR ${data.fd_book.toLocaleString()}`} sub={`${data.active_fds} active`} icon={<PiggyBank size={18} />} color="emerald" />
        <StatCard label="Accounts" value={data.total_accounts} icon={<Banknote size={18} />} color="blue" />
        <StatCard label="Transactions" value={data.total_transactions} icon={<Receipt size={18} />} color="violet" />
        <StatCard label="Branches" value={data.branches} icon={<Building2 size={18} />} color="teal" />
        <StatCard label="Users" value={data.users} icon={<Users size={18} />} color="default" />
        <StatCard label="Active loans" value={data.active_loans} icon={<Banknote size={18} />} color="red" />
      </div>

      {tb && (
        <Card>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink flex items-center gap-2"><Scale size={16} /> GL trial balance</span>
            <Badge variant={tb.balanced ? "success" : "danger"}>{tb.balanced ? "Balanced" : `Off by ${tb.difference}`}</Badge>
          </div>
          <p className="text-xs text-ink-soft mt-1">Debit NPR {tb.total_debit.toLocaleString()} · Credit NPR {tb.total_credit.toLocaleString()}</p>
        </Card>
      )}

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-3">Branch deposit leaderboard</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-ink-soft border-b border-line"><th className="py-2 pr-4">Branch</th><th className="py-2 pr-4">Accounts</th><th className="py-2 text-right">Deposits</th></tr></thead>
          <tbody>
            {data.branch_leaderboard.map((b, i) => (
              <tr key={i} className="border-b border-line/50">
                <td className="py-2 pr-4 font-medium capitalize">{b.branch}</td>
                <td className="py-2 pr-4">{b.accounts}</td>
                <td className="py-2 text-right">NPR {b.deposits.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
