"use client";

import { useState, useEffect, useCallback } from "react";
import { tellerCashPosition, type CashPosition } from "@/lib/api";
import { Card, StatCard, Spinner, Button } from "@/components/ui";
import { ArrowDownCircle, ArrowUpCircle, FileCheck, Wallet, RefreshCw } from "lucide-react";

export default function CashPositionPage() {
  const [data, setData] = useState<CashPosition | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    tellerCashPosition().then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="text-danger p-6">{error}</div>;
  if (!data) return <div className="flex justify-center p-12"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Today's cash position — {data.cashier}</h2>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw size={14} /> Refresh</Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Cash deposits" value={`NPR ${data.cash_deposits.toLocaleString()}`} sub={`${data.deposit_count} txns`} icon={<ArrowDownCircle size={18} />} color="emerald" />
        <StatCard label="Cash withdrawals" value={`NPR ${data.cash_withdrawals.toLocaleString()}`} sub={`${data.withdrawal_count} txns`} icon={<ArrowUpCircle size={18} />} color="red" />
        <StatCard label="Cheque deposits" value={`NPR ${data.cheque_deposits.toLocaleString()}`} icon={<FileCheck size={18} />} color="blue" />
        <StatCard label="Net cash position" value={`NPR ${data.net_cash_position.toLocaleString()}`} icon={<Wallet size={18} />} color="gold" />
      </div>
      <Card>
        <p className="text-xs text-ink-soft">Net = cash deposits + cheque deposits − cash withdrawals processed by you today. Use this for end-of-day drawer reconciliation against physical cash.</p>
      </Card>
    </div>
  );
}
