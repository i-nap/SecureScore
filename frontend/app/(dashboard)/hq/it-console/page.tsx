"use client";

import { useState, useEffect, useCallback } from "react";
import { itSystem, type ITSystem } from "@/lib/api";
import { Card, StatCard, Badge, Spinner, Button } from "@/components/ui";
import { Server, Users, ShieldAlert, Activity, RefreshCw } from "lucide-react";

export default function ITConsolePage() {
  const [data, setData] = useState<ITSystem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    itSystem().then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="text-danger p-6">{error}</div>;
  if (!data) return <div className="flex justify-center p-12"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server size={18} className="text-ink-soft" />
          <span className="text-sm font-semibold text-ink">System status</span>
          <Badge variant={data.status === "operational" ? "success" : "danger"}>{data.status}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw size={14} /> Refresh</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Database" value={data.db_ok ? "Online" : "Down"} icon={<Server size={18} />} color={data.db_ok ? "emerald" : "red"} />
        <StatCard label="Active users" value={`${data.active_users}/${data.total_users}`} icon={<Users size={18} />} color="blue" />
        <StatCard label="Txns today" value={data.transactions_today} icon={<Activity size={18} />} color="violet" />
        <StatCard label="Banned IPs" value={`${data.banned_ips}/${data.tracked_ips}`} sub="IDS" icon={<ShieldAlert size={18} />} color={data.banned_ips > 0 ? "amber" : "default"} />
      </div>

      <Card>
        <p className="text-xs text-ink-soft">Live system health from the BFF. IDS tracks {data.tracked_ips} IPs, {data.banned_ips} currently banned. Database connectivity and user/transaction counts refresh on demand.</p>
      </Card>
    </div>
  );
}
