"use client";

import { useEffect, useState } from "react";
import { hqModelRegistry } from "@/lib/api";
import { Card, Spinner, EmptyState, Badge } from "@/components/ui";
import { Package } from "lucide-react";

interface ModelEntry {
  round: number;
  timestamp?: string;
  method?: string;
  participants?: string[];
  version?: string;
  [key: string]: unknown;
}

export default function ModelsPage() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    hqModelRegistry()
      .then((res) => setModels((res.models as ModelEntry[]) || []))
      .catch((e) => setError(e?.message || "Failed to load model registry"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || models.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-ink">Model Registry</h1>
        <EmptyState
          message={error || "No global models registered yet. Run a FedAvg aggregation first."}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Model Registry</h1>
        <p className="text-sm text-ink-soft mt-1">{models.length} global model version(s)</p>
      </div>

      <div className="space-y-3">
        {models
          .sort((a, b) => (b.round ?? 0) - (a.round ?? 0))
          .map((model, idx) => (
            <Card key={idx} className="!p-4">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-purple-100 text-teal flex items-center justify-center">
                  <Package size={20} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-ink">
                      Global Model v{model.version || model.round}
                    </h3>
                    <span className="text-xs text-ink-faint">
                      {model.timestamp ? new Date(model.timestamp).toLocaleString() : ""}
                    </span>
                  </div>
                  <p className="text-xs text-ink-soft mt-1">
                    Round: {model.round} &middot; Method: {model.method || "FedAvg"}
                  </p>
                  {model.participants && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {model.participants.map((p) => (
                        <Badge key={p} variant="default">{p}</Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
      </div>
    </div>
  );
}
