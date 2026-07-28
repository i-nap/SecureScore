"use client";

import { useEffect, useState } from "react";
import { hqPiDevices, type PiDevice } from "@/lib/api";
import { Card, Badge, Spinner, EmptyState } from "@/components/ui";
import { Server, Thermometer, Cpu, HardDrive, Clock } from "lucide-react";

function MetricGauge({ label, value, max, unit, icon }: {
  label: string; value: number | null; max: number; unit: string; icon: React.ReactNode;
}) {
  const pct = value != null ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const color = pct > 85 ? "bg-red-500" : pct > 65 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-ink-soft">
        <span className="flex items-center gap-1">{icon}{label}</span>
        <span className="font-mono text-ink">
          {value != null ? `${value}${unit}` : "—"}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function uptime(secs: number | null | undefined): string {
  if (secs == null) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function DeviceCard({ device }: { device: PiDevice }) {
  const hw = device.hardware;
  const branch = device.branch.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${device.online ? "bg-emerald-50" : "bg-gray-100"}`}>
            <Server size={20} className={device.online ? "text-emerald-600" : "text-ink-faint"} />
          </div>
          <div>
            <h3 className="font-semibold text-ink">{branch}</h3>
            <p className="text-xs text-ink-soft">{device.ip ?? "IP unknown"}</p>
          </div>
        </div>
        <Badge variant={device.online ? "success" : "danger"}>
          {device.online ? "Online" : "Offline"}
        </Badge>
      </div>

      {hw && (
        <div className="space-y-2.5">
          <MetricGauge
            label="CPU Temp"
            value={hw.cpu_temp_c}
            max={90}
            unit="°C"
            icon={<Thermometer size={11} />}
          />
          <MetricGauge
            label="CPU"
            value={hw.cpu_percent}
            max={100}
            unit="%"
            icon={<Cpu size={11} />}
          />
          <MetricGauge
            label="Memory"
            value={hw.memory_percent}
            max={100}
            unit="%"
            icon={<HardDrive size={11} />}
          />
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-ink-soft pt-1 border-t border-line">
        <span className="flex items-center gap-1">
          <Clock size={11} /> Uptime: {uptime(hw?.uptime_seconds)}
        </span>
        {device.offline_rounds != null && device.offline_rounds > 0 && (
          <Badge variant="warning">{device.offline_rounds} buffered</Badge>
        )}
        {device.last_seen && (
          <span>Last seen: {new Date(device.last_seen).toLocaleTimeString()}</span>
        )}
      </div>
    </Card>
  );
}

function SetupGuide() {
  return (
    <Card className="bg-gray-900 text-gray-200">
      <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
        <Server size={16} /> Pi Setup Guide
      </h3>
      <ol className="space-y-2 text-sm text-ink-faint list-decimal list-inside">
        <li>Copy project files to Pi: <code className="text-gray-200 text-xs">rsync -avz . pi@raspberrypi.local:/opt/securescore/</code></li>
        <li>Run setup: <code className="text-gray-200 text-xs">sudo bash /opt/securescore/pi_edge/setup_pi.sh</code></li>
        <li>Edit config: <code className="text-gray-200 text-xs">sudo nano /etc/securescore/pi.env</code></li>
        <li>Start service: <code className="text-gray-200 text-xs">sudo systemctl start securescore-pi</code></li>
        <li>Check logs: <code className="text-gray-200 text-xs">journalctl -u securescore-pi -f</code></li>
      </ol>
    </Card>
  );
}

export default function PiDevicesPage() {
  const [devices, setDevices] = useState<PiDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    hqPiDevices()
      .then(({ pi_devices, total }) => { setDevices(pi_devices); setTotal(total); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  const online = devices.filter((d) => d.online).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Server className="text-teal" size={28} />
        <div>
          <h1 className="text-2xl font-bold text-ink">Raspberry Pi Branch Devices</h1>
          <p className="text-sm text-ink-soft">
            {online}/{total} online · lightweight XGBoost edge nodes (30 trees, depth 3)
          </p>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {devices.length === 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <EmptyState message="No Pi devices registered yet. Follow the setup guide to connect a Raspberry Pi branch node." />
          </div>
          <SetupGuide />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {devices.map((d) => <DeviceCard key={d.branch} device={d} />)}
          </div>
          <SetupGuide />
        </>
      )}
    </div>
  );
}
