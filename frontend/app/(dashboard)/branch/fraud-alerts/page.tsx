"use client";

import { useEffect, useState } from "react";
import { branchFraudAlerts, branchIngestTransaction, type FraudAlert } from "@/lib/api";
import { useWsEvents } from "@/lib/ws-context";
import { Card, Badge, Spinner, EmptyState } from "@/components/ui";
import { AlertTriangle, Zap } from "lucide-react";

export default function FraudAlertsPage() {
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [simCustomer, setSimCustomer] = useState("CUST100005");
  const [simAmount, setSimAmount] = useState(75000);
  const [simIntl, setSimIntl] = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState("");
  const { events } = useWsEvents();

  // Fetch initial alerts
  useEffect(() => {
    branchFraudAlerts()
      .then((res) => setAlerts(res.alerts || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Listen for real-time fraud alerts via WS
  const realtimeAlerts = events
    .filter((e) => e.type === "fraud_alert")
    .map((e) => e.data as unknown as FraudAlert);

  const allAlerts = [...realtimeAlerts, ...alerts];

  const simulate = async () => {
    setSimLoading(true);
    setSimError("");
    try {
      await branchIngestTransaction({
        customer_id: simCustomer,
        amount: simAmount,
        merchant: "Demo Merchant",
        is_international: simIntl,
        timestamp: new Date().toISOString(),
        channel: "wallet",
      });
    } catch (e: unknown) {
      setSimError((e as Error).message);
    } finally {
      setSimLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Fraud Alerts</h1>
          <p className="text-sm text-ink-soft mt-1">
            {allAlerts.length} anomalies detected via z-score analysis
          </p>
        </div>
        {realtimeAlerts.length > 0 && (
          <Badge variant="danger">
            <Zap size={12} className="mr-1" />
            {realtimeAlerts.length} live
          </Badge>
        )}
      </div>

      <Card className="!p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-ink">Live Transaction Simulator</p>
          <span className="text-xs text-ink-faint">Triggers WS fraud alerts</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            value={simCustomer}
            onChange={(e) => setSimCustomer(e.target.value)}
            className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
            placeholder="Customer ID"
          />
          <input
            type="number"
            value={simAmount}
            onChange={(e) => setSimAmount(Number(e.target.value))}
            className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm"
            placeholder="Amount"
          />
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={simIntl}
              onChange={(e) => setSimIntl(e.target.checked)}
            />
            International
          </label>
          <button
            onClick={simulate}
            disabled={simLoading}
            className="rounded-lg bg-red-600 text-white text-sm font-semibold py-2 disabled:opacity-60"
          >
            {simLoading ? "Sending..." : "Send Transaction"}
          </button>
        </div>
        {simError && <p className="text-xs text-red-600 mt-2">{simError}</p>}
      </Card>

      {allAlerts.length === 0 ? (
        <EmptyState message="No fraud alerts detected. All transactions look normal." />
      ) : (
        <div className="space-y-3">
          {allAlerts.map((alert, idx) => {
            const sev = alert.severity || (Math.abs(alert.z_score) > 3 ? "high" : "medium");
            return (
              <Card
                key={`${alert.customer_id}-${alert.metric}-${idx}`}
                className={`!p-4 border-l-4 ${
                  sev === "high" ? "border-l-red-500" : sev === "medium" ? "border-l-amber-500" : "border-l-blue-500"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex gap-3">
                    <div className={`mt-0.5 ${sev === "high" ? "text-red-500" : "text-amber-500"}`}>
                      <AlertTriangle size={20} />
                    </div>
                    <div>
                      <p className="font-medium text-ink text-sm">
                        {alert.metric.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </p>
                      <p className="text-xs text-ink-soft mt-0.5">
                        Customer: <span className="font-mono">{alert.customer_id}</span>
                      </p>
                      <p className="text-xs text-ink-soft">
                        Value: {typeof alert.value === "number" ? alert.value.toLocaleString() : alert.value} &middot;
                        Z-Score: <span className="font-semibold">{alert.z_score?.toFixed(2)}</span>
                      </p>
                    </div>
                  </div>
                  <Badge variant={sev === "high" ? "danger" : sev === "medium" ? "warning" : "default"}>
                    {sev}
                  </Badge>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
