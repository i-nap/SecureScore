"use client";

import { useEffect, useState } from "react";
import { hqBranches, hqStatus, type BranchInfo, type HqStatus } from "@/lib/api";
import { useWsEvents } from "@/lib/ws-context";
import { Card, StatCard, Badge, Spinner } from "@/components/ui";
import { Globe, Radio, CheckCircle, Wifi } from "lucide-react";

const TYPE_COLOR: Record<string, string> = {
  urban: "bg-blue-500",
  semi_urban: "bg-amber-500",
  rural: "bg-emerald-500",
};

const TYPE_BORDER: Record<string, string> = {
  urban: "border-blue-400",
  semi_urban: "border-amber-400",
  rural: "border-emerald-400",
};

export default function HqDashboard() {
  const [status, setStatus] = useState<HqStatus | null>(null);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { events } = useWsEvents();

  useEffect(() => {
    Promise.all([hqStatus().catch(() => null), hqBranches().catch(() => null)])
      .then(([s, b]) => {
        if (s) setStatus(s);
        if (b) setBranches(b.branches);
      })
      .finally(() => setLoading(false));
  }, []);

  // Count real-time events
  const weightSubmissions = events.filter((e) => e.type === "weight_submission").length;
  const aggregations = events.filter((e) => e.type === "aggregation_complete").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  const registeredCount = branches.filter((b) => b.registered).length;
  const submittedCount = branches.filter((b) => b.submitted_this_round).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">HQ Command Center</h1>
        <p className="text-sm text-ink-soft mt-1">
          Federation network overview &middot; {branches.length} branches configured
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Current Round"
          value={status?.current_round ?? 0}
          icon={<Globe size={24} />}
          color="blue"
        />
        <StatCard
          label="Branches Online"
          value={`${registeredCount}/${branches.length}`}
          icon={<Radio size={24} />}
          color={registeredCount === branches.length ? "green" : "amber"}
        />
        <StatCard
          label="Submissions This Round"
          value={submittedCount}
          sub={`of ${status?.min_branches ?? 0} minimum`}
          icon={<CheckCircle size={24} />}
          color="purple"
        />
        <StatCard
          label="Global Model"
          value={status?.global_model_ready ? "Ready" : "Not Ready"}
          icon={<Wifi size={24} />}
          color={status?.global_model_ready ? "green" : "red"}
        />
      </div>

      {/* Live events ticker */}
      {(weightSubmissions > 0 || aggregations > 0) && (
        <Card className="!p-3">
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1 text-teal">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              LIVE
            </span>
            {weightSubmissions > 0 && (
              <span className="text-ink-soft">{weightSubmissions} weight submission(s) received</span>
            )}
            {aggregations > 0 && (
              <span className="text-emerald-600">{aggregations} aggregation(s) completed</span>
            )}
          </div>
        </Card>
      )}

      {/* Branch network map / grid */}
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4">Branch Network</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {branches.map((branch) => (
            <div
              key={branch.slug}
              className={`rounded-xl border-2 p-4 transition-all ${
                branch.registered ? TYPE_BORDER[branch.type] || "border-gray-300" : "border-line opacity-60"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${branch.registered ? "bg-emerald-500" : "bg-gray-300"}`} />
                  <span className="font-medium text-sm text-ink">
                    {branch.name}
                  </span>
                </div>
                <span className={`w-3 h-3 rounded-full ${TYPE_COLOR[branch.type] || "bg-gray-400"}`} title={branch.type} />
              </div>

              <div className="space-y-1 text-xs text-ink-soft">
                <p>Type: <span className="capitalize font-medium">{branch.type}</span></p>
                <p>
                  Status:{" "}
                  {branch.registered ? (
                    <Badge variant="success">Registered</Badge>
                  ) : (
                    <Badge variant="default">Offline</Badge>
                  )}
                </p>
                {branch.submitted_this_round && (
                  <p>
                    <Badge variant="success">
                      <CheckCircle size={10} className="mr-1" />
                      Submitted
                    </Badge>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-4 text-xs text-ink-soft">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Urban</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Semi-Urban</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Rural</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" /> Online</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-300" /> Offline</span>
        </div>
      </Card>
    </div>
  );
}
