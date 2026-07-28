"use client";

import { useState, useEffect, useCallback } from "react";
import {
  hqWatermarkEmbed,
  hqWatermarkVerify,
  hqWatermarkStatus,
  type WatermarkStatus,
  type WatermarkVerifyResult,
} from "@/lib/api";
import { Card, Button, Badge, Spinner } from "@/components/ui";
import { Stamp, ShieldCheck, ShieldAlert, Info } from "lucide-react";

export default function WatermarkingPage() {
  const [status, setStatus] = useState<WatermarkStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Embed
  const [ownerId, setOwnerId] = useState("SecureScore-HQ");
  const [strength, setStrength] = useState(0.15);
  const [embedResult, setEmbedResult] = useState<WatermarkStatus | null>(null);
  const [embedLoading, setEmbedLoading] = useState(false);
  const [embedError, setEmbedError] = useState("");

  // Verify
  const [verifyId, setVerifyId] = useState("");
  const [verifyResult, setVerifyResult] = useState<WatermarkVerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyError, setVerifyError] = useState("");

  const loadStatus = useCallback(() => {
    setStatusLoading(true);
    hqWatermarkStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setStatusLoading(false));
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleEmbed = async () => {
    setEmbedLoading(true); setEmbedError(""); setEmbedResult(null);
    try {
      const res = await hqWatermarkEmbed(ownerId, strength);
      setEmbedResult(res);
      if (res.watermark_id) setVerifyId(res.watermark_id);
      loadStatus();
    } catch (e: unknown) {
      setEmbedError(e instanceof Error ? e.message : "Failed to embed watermark");
    } finally {
      setEmbedLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!verifyId.trim()) return;
    setVerifyLoading(true); setVerifyError(""); setVerifyResult(null);
    try {
      setVerifyResult(await hqWatermarkVerify(verifyId.trim()));
    } catch (e: unknown) {
      setVerifyError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Stamp size={24} className="text-violet-500" />
          Model Watermarking
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          Intellectual property protection for the global federated model
        </p>
      </div>

      {/* Explanation */}
      <Card className="bg-teal-soft/40 border border-teal/20">
        <div className="flex gap-3">
          <Info size={18} className="text-violet-500 shrink-0 mt-0.5" />
          <p className="text-sm text-violet-800">
            Model watermarking embeds invisible backdoor trigger patterns into the global model.
            If the model is stolen and deployed elsewhere, HQ can verify ownership by querying the
            model with secret trigger inputs — even without access to the stolen copy.
          </p>
        </div>
      </Card>

      {/* Status */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-ink mb-1">Watermark Status</h2>
            {statusLoading ? (
              <Spinner size="sm" />
            ) : status ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={status.status === "active" || status.watermark_id ? "success" : "default"}>
                    {status.watermark_id ? "ACTIVE" : status.status?.toUpperCase() ?? "NONE"}
                  </Badge>
                  {status.watermark_id && (
                    <span className="text-xs font-mono text-ink-soft">{status.watermark_id}</span>
                  )}
                </div>
                {status.owner_id && (
                  <p className="text-xs text-ink-soft">Owner: <span className="font-medium">{status.owner_id}</span></p>
                )}
                {status.embedded_at && (
                  <p className="text-xs text-ink-soft">
                    Embedded: {new Date(status.embedded_at).toLocaleString()}
                  </p>
                )}
                {status.n_triggers && (
                  <p className="text-xs text-ink-soft">Trigger patterns: {status.n_triggers}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-ink-faint">No watermark status available</p>
            )}
          </div>
          <button
            onClick={loadStatus}
            className="text-xs text-teal hover:underline"
          >
            Refresh
          </button>
        </div>
      </Card>

      {/* Embed Section */}
      <Card>
        <h2 className="font-semibold text-ink mb-3">Embed Watermark</h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-ink-soft block mb-1">Owner ID</label>
            <input
              type="text"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-violet-400 outline-none"
              placeholder="SecureScore-HQ"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-soft block mb-1">
              Strength: <span className="text-teal font-bold">{strength.toFixed(2)}</span>
              <span className="text-ink-faint ml-1">(higher = stronger mark, slight model impact)</span>
            </label>
            <input
              type="range"
              min={0.05} max={0.30} step={0.01}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-[10px] text-ink-faint mt-0.5">
              <span>0.05 (subtle)</span><span>0.30 (strong)</span>
            </div>
          </div>
          <Button onClick={handleEmbed} disabled={embedLoading || !ownerId.trim()} className="bg-teal hover:bg-teal-deep text-white border-none">
            {embedLoading ? <Spinner size="sm" /> : "Embed Watermark"}
          </Button>
        </div>

        {embedError && <p className="text-sm text-red-600 mt-3">{embedError}</p>}

        {embedResult && (
          <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200 space-y-1.5">
            <p className="text-sm font-bold text-green-700">Watermark Embedded Successfully</p>
            {embedResult.watermark_id && (
              <p className="text-xs font-mono text-ink">
                ID: <span className="text-teal-deep">{embedResult.watermark_id}</span>
              </p>
            )}
            {embedResult.owner_id && (
              <p className="text-xs text-ink-soft">Owner: {embedResult.owner_id}</p>
            )}
            {embedResult.verification_key && (
              <p className="text-xs font-mono text-ink">
                Key: <span className="text-teal-deep">{embedResult.verification_key}</span>
              </p>
            )}
            {embedResult.embedded_at && (
              <p className="text-xs text-ink-soft">
                At: {new Date(embedResult.embedded_at).toLocaleString()}
              </p>
            )}
            {embedResult.n_triggers && (
              <p className="text-xs text-ink-soft">Triggers embedded: {embedResult.n_triggers}</p>
            )}
          </div>
        )}
      </Card>

      {/* Verify Section */}
      <Card>
        <h2 className="font-semibold text-ink mb-3">Verify Ownership</h2>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={verifyId}
            onChange={(e) => setVerifyId(e.target.value)}
            placeholder="Enter watermark ID..."
            className="flex-1 border border-line rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-violet-400 outline-none"
          />
          <Button onClick={handleVerify} disabled={verifyLoading || !verifyId.trim()}>
            {verifyLoading ? <Spinner size="sm" /> : "Verify Ownership"}
          </Button>
        </div>

        {verifyError && <p className="text-sm text-red-600 mb-2">{verifyError}</p>}

        {verifyResult && (
          <div className="space-y-4">
            {/* Big result */}
            <div className={`flex items-center gap-3 p-4 rounded-xl ${
              verifyResult.verified
                ? "bg-green-50 border border-green-200"
                : "bg-red-50 border border-red-200"
            }`}>
              {verifyResult.verified ? (
                <ShieldCheck size={28} className="text-green-600 shrink-0" />
              ) : (
                <ShieldAlert size={28} className="text-red-600 shrink-0" />
              )}
              <div>
                <p className={`text-lg font-black ${verifyResult.verified ? "text-green-700" : "text-red-700"}`}>
                  {verifyResult.verified ? "OWNERSHIP VERIFIED ✓" : "WATERMARK NOT FOUND ✗"}
                </p>
                <p className="text-xs text-ink-soft mt-0.5">
                  Confidence: <span className="font-semibold">{verifyResult.confidence}</span>
                  {" · "}Owner: <span className="font-semibold">{verifyResult.owner_id}</span>
                </p>
              </div>
            </div>

            {/* Trigger match rate */}
            <div>
              <div className="flex justify-between text-xs text-ink-soft mb-1">
                <span>Trigger match rate</span>
                <span className="font-bold">
                  {verifyResult.triggers_matched}/{verifyResult.triggers_total} ({(verifyResult.match_rate * 100).toFixed(0)}%)
                </span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${verifyResult.verified ? "bg-green-500" : "bg-red-400"}`}
                  style={{ width: `${verifyResult.match_rate * 100}%` }}
                />
              </div>
            </div>

            <p className="text-xs text-ink-soft">{verifyResult.interpretation}</p>
            <p className="text-xs text-ink-faint">
              Embedded: {new Date(verifyResult.embedded_at).toLocaleString()}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
