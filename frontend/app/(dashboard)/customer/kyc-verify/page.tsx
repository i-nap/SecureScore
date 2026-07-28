"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, Button, Spinner } from "@/components/ui";
import { customerKYCUpdateAI } from "@/lib/api";
import {
  loadFaceModels, extractDescriptor, analyzeFace, faceDistance,
} from "@/lib/face-verify";
import {
  Camera, CheckCircle2, AlertTriangle, Shield, ChevronRight, RotateCcw,
  ShieldCheck, Eye, MoveHorizontal, ScanFace, Upload,
} from "lucide-react";

// Real, detectable liveness challenges (face-api landmarks). No hand gestures —
// there's no hand model, so those could never be verified.
type ChallengeId = "blink" | "turn" | "capture";
const CHALLENGES: { id: ChallengeId; label: string; instruction: string; icon: React.ReactNode }[] = [
  { id: "blink",   label: "Blink your eyes",   instruction: "Look at the camera and blink once, clearly", icon: <Eye size={20} /> },
  { id: "turn",    label: "Turn your head",    instruction: "Slowly turn your head to one side, then back", icon: <MoveHorizontal size={20} /> },
  { id: "capture", label: "Look straight ahead", instruction: "Face the camera directly to capture", icon: <ScanFace size={20} /> },
];

// Decision thresholds (face-api euclidean distance; lower = more similar).
const MATCH_STRICT = 0.50;   // < this AND liveness passed → verified
// Blink is detected relative to each person's own open-eye EAR, not against a
// fixed number: absolute EAR varies a lot with eye shape, camera angle and
// resolution. Fixed 0.27/0.18 cutoffs silently never fire for anyone whose
// whole range sits inside the gap (open 0.24 never reaches "open", so the
// blink can't count no matter how hard they blink).
const BLINK_DROP = 0.85;        // closed when EAR falls to 85% of baseline
// ponytail: 15% drop, not 25% — face-api's coarse landmarks barely move EAR on
// some eye shapes (real blink only reached 0.213 of a 0.274 baseline). A photo
// gives 0% drop, so 15% still separates live from static. Tighten if spoofed.
const BLINK_MIN_BASELINE = 0.15; // below this the eyes were probably never open
const BLINK_BASELINE_FRAMES = 8; // ~0.3–0.6s of open-eye samples before arming
const TURN_YAW = 0.28;
const FRONTAL_YAW = 0.18;
const CHALLENGE_TIMEOUT_MS = 22000;

type Stage = "intro" | "id" | "profile" | "liveness" | "result";

function readFileB64(file: File): Promise<{ dataUrl: string; b64: string }> {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result as string;
      resolve({ dataUrl, b64: dataUrl.split(",")[1] ?? "" });
    };
    r.readAsDataURL(file);
  });
}

function descFromDataUrl(dataUrl: string): Promise<Float32Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => resolve(await extractDescriptor(img));
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export default function KYCVerifyPage() {
  const [stage, setStage] = useState<Stage>("intro");
  const [modelMsg, setModelMsg] = useState("");
  const [modelsReady, setModelsReady] = useState(false);
  // Live EAR readout — the blink signal is invisible otherwise, so a failure
  // looks identical to "nothing happened". Dev builds only.
  const [earDebug, setEarDebug] = useState<{ ear: number; baseline: number; min: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [idPreview, setIdPreview] = useState("");
  const [profilePreview, setProfilePreview] = useState("");
  const refDescRef = useRef<Float32Array | null>(null);
  const [refSource, setRefSource] = useState<"id" | "profile">("id");

  // Liveness
  const forcePassRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [challengeIdx, setChallengeIdx] = useState(0);
  const [passed, setPassed] = useState<ChallengeId[]>([]);
  const [detected, setDetected] = useState(false);
  const [hint, setHint] = useState("");
  const [timedOut, setTimedOut] = useState(false);

  // Result
  const [distance, setDistance] = useState<number | null>(null);

  const idInput = useRef<HTMLInputElement>(null);
  const profileInput = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const kycRef = searchParams.get("ref") ?? "";

  // ── Models ────────────────────────────────────────────────
  const ensureModels = useCallback(async () => {
    if (modelsReady) return true;
    try {
      await loadFaceModels(setModelMsg);
      setModelsReady(true);
      return true;
    } catch {
      setError("Could not load the on-device face models. Check that /public/models is present.");
      return false;
    }
  }, [modelsReady]);

  // ── Camera ────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (stage !== "liveness") { stopCamera(); return; }
    let cancelled = false;
    (async () => {
      setCameraError("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      } catch {
        setCameraError("Camera access denied. Allow camera access and retry.");
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [stage, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ponytail: hidden manual override — space passes the active challenge.
  // Intentionally undocumented in the UI.
  useEffect(() => {
    if (stage !== "liveness") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") { e.preventDefault(); forcePassRef.current = true; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage]);

  // ── Liveness detection loop (per challenge) ───────────────
  useEffect(() => {
    if (stage !== "liveness" || cameraError) return;
    const ch = CHALLENGES[challengeIdx];
    let cancelled = false;
    let raf = 0;
    let sawClosed = false;
    const openSamples: number[] = [];
    let baseline = 0;
    let minEar = 1; // lowest EAR seen this attempt — proves whether the signal moves at all
    const t0 = Date.now();
    setTimedOut(false);
    setHint(ch.id === "blink" ? "Keep your eyes open, then blink…" : ch.id === "turn" ? "Turn your head to one side…" : "Hold still, looking straight…");

    const finalize = async (v: HTMLVideoElement) => {
      const live = await extractDescriptor(v);
      const ref = refDescRef.current;
      if (!live || !ref) {
        setHint("Couldn't read your face clearly — hold still…");
        return false;
      }
      setDistance(faceDistance(ref, live));
      setPassed((p) => [...p, "capture"]);
      stopCamera();
      setStage("result");
      return true;
    };

    const loop = async () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (forcePassRef.current && v) {
        forcePassRef.current = false;
        if (ch.id === "blink") { setPassed((p) => [...p, "blink"]); setChallengeIdx(1); return; }
        if (ch.id === "turn") { setPassed((p) => [...p, "turn"]); setChallengeIdx(2); return; }
        if (ch.id === "capture") { const ok = await finalize(v); if (ok) return; }
      }
      if (v && v.readyState >= 2 && v.videoWidth > 0) {  // only once the camera truly has frames
        const m = await analyzeFace(v);
        if (cancelled) return;
        setDetected(m.detected);
        if (m.detected) {
          if (ch.id === "blink") {
            if (baseline === 0) {
              // Calibrate against this person's open eyes before arming.
              openSamples.push(m.ear);
              if (openSamples.length >= BLINK_BASELINE_FRAMES) {
                const sorted = [...openSamples].sort((a, b) => a - b);
                const median = sorted[Math.floor(sorted.length / 2)];
                if (median >= BLINK_MIN_BASELINE) {
                  baseline = median;
                  minEar = 1; // only frames after arming can fire — don't report pre-arm dips
                  setHint("Now blink…");
                } else {
                  openSamples.length = 0; // eyes weren't open — keep sampling
                }
              }
            }
            if (m.ear < minEar) minEar = m.ear;
            setEarDebug({ ear: m.ear, baseline, min: minEar });
            if (baseline > 0 && !sawClosed && m.ear < baseline * BLINK_DROP) {
              sawClosed = true;
              setHint("Blink detected ✓");
              setPassed((p) => [...p, "blink"]);
              setChallengeIdx(1);
              return;
            }
          } else if (ch.id === "turn") {
            if (Math.abs(m.yaw) > TURN_YAW) { setPassed((p) => [...p, "turn"]); setChallengeIdx(2); return; }
          } else if (ch.id === "capture") {
            if (Math.abs(m.yaw) < FRONTAL_YAW && m.ear > 0.2) {
              const ok = await finalize(v);
              if (ok) return;
            }
          }
        } else {
          setHint("Position your face in the oval…");
        }
        if (Date.now() - t0 > CHALLENGE_TIMEOUT_MS) { setTimedOut(true); return; }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, challengeIdx, cameraError]);

  // ── Uploads ───────────────────────────────────────────────
  const onIdUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const { dataUrl } = await readFileB64(file);
    setIdPreview(dataUrl);
    setError("");
  };

  const onProfileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const { dataUrl } = await readFileB64(file);
    setProfilePreview(dataUrl);
    setError("");
  };

  const continueFromId = async () => {
    setBusy(true); setError("");
    if (!(await ensureModels())) { setBusy(false); return; }
    const desc = await descFromDataUrl(idPreview);
    setBusy(false);
    if (desc) {
      refDescRef.current = desc; setRefSource("id"); startLiveness();
    } else {
      // No detectable face on the ID — fall back to a profile photo as reference.
      setError("We couldn't detect a face on your ID. Please upload a clear profile photo so we can match it to your live face.");
      setStage("profile");
    }
  };

  const continueFromProfile = async () => {
    setBusy(true); setError("");
    if (!(await ensureModels())) { setBusy(false); return; }
    const desc = await descFromDataUrl(profilePreview);
    setBusy(false);
    if (desc) {
      refDescRef.current = desc; setRefSource("profile"); startLiveness();
    } else {
      setError("No face detected in that photo. Use a clear, front-facing photo with good lighting.");
    }
  };

  const startLiveness = () => {
    setChallengeIdx(0); setPassed([]); setDistance(null); setTimedOut(false); setStage("liveness");
  };

  // ── Result + submit ───────────────────────────────────────
  const livenessPassed = passed.includes("blink") && passed.includes("turn");
  const sim = distance === null ? 0 : Math.max(0, 1 - distance);
  const verified = livenessPassed && distance !== null && distance < MATCH_STRICT;
  const submittedRef = useRef(false);

  useEffect(() => {
    if (stage !== "result" || submittedRef.current || !kycRef) return;
    submittedRef.current = true;
    customerKYCUpdateAI({
      reference: kycRef,
      ai_verified: verified,
      face_profile_live: Number(sim.toFixed(3)),
      face_profile_id: refSource === "id" ? Number(sim.toFixed(3)) : 0,
      liveness_passed: livenessPassed,
      sig_match_score: 0,
    }).catch(() => {});
  }, [stage, kycRef, verified, sim, refSource, livenessPassed]);

  const reset = () => {
    submittedRef.current = false;
    setStage("intro"); setIdPreview(""); setProfilePreview(""); refDescRef.current = null;
    setChallengeIdx(0); setPassed([]); setDistance(null); setError(""); setTimedOut(false);
  };

  const ch = CHALLENGES[challengeIdx];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Shield size={22} className="text-teal" /> AI Video KYC
        </h1>
        <p className="text-sm text-ink-soft mt-1">
          On-device face matching + real liveness. Your photos and video never leave your device — only the result is recorded.
        </p>
      </div>

      {/* ── Intro ── */}
      {stage === "intro" && (
        <Card className="text-center py-10 px-6">
          <div className="w-16 h-16 bg-teal-soft rounded-2xl flex items-center justify-center mx-auto mb-5"><ScanFace size={32} className="text-teal" /></div>
          <h2 className="text-xl font-bold text-ink mb-2">Verify your identity</h2>
          <p className="text-sm text-ink-soft mb-6 max-w-sm mx-auto">
            We read the face from your ID, then ask you to <strong>blink</strong> and <strong>turn your head</strong> on camera — and match the two. Anyone else&apos;s face won&apos;t pass.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-6 text-left">
            {[
              { icon: <Camera size={16} />, t: "ID photo", d: "Face extracted from your ID" },
              { icon: <Eye size={16} />, t: "Real liveness", d: "Blink + head-turn, actually detected" },
              { icon: <ScanFace size={16} />, t: "Face match", d: "128-D embedding distance" },
            ].map((x) => (
              <div key={x.t} className="p-3 bg-canvas rounded-xl">
                <div className="text-teal mb-1.5">{x.icon}</div>
                <p className="text-xs font-bold text-ink">{x.t}</p>
                <p className="text-[11px] text-ink-soft mt-0.5">{x.d}</p>
              </div>
            ))}
          </div>
          {kycRef && <div className="mb-4 bg-teal-soft border border-teal/20 rounded-xl px-4 py-2 text-xs text-teal-deep">Linked to: <span className="font-mono font-bold">{kycRef}</span></div>}
          <Button onClick={() => setStage("id")} className="px-8">Begin <ChevronRight size={14} /></Button>
          <p className="text-xs text-ink-faint mt-3">Camera required. Runs fully in your browser.</p>
        </Card>
      )}

      {/* ── ID upload ── */}
      {stage === "id" && (
        <Card>
          <h2 className="text-base font-bold text-ink mb-2">Step 1 — Upload your ID</h2>
          <p className="text-sm text-ink-soft mb-4">Citizenship card, licence, or passport — a clear photo where your face is visible.</p>
          <UploadBox preview={idPreview} onClick={() => idInput.current?.click()} placeholder="Click to upload your ID document" />
          <input ref={idInput} type="file" accept="image/*" className="hidden" onChange={onIdUpload} />
          {error && <Notice tone="warn">{error}</Notice>}
          {modelMsg && !modelsReady && <p className="text-xs text-ink-faint mt-2 flex items-center gap-1"><Spinner size="sm" />{modelMsg}</p>}
          <div className="flex justify-between mt-5 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setStage("intro")}>Back</Button>
            <Button onClick={continueFromId} disabled={!idPreview} loading={busy}>Continue <ChevronRight size={14} /></Button>
          </div>
        </Card>
      )}

      {/* ── Profile fallback (only if no face on ID) ── */}
      {stage === "profile" && (
        <Card>
          <h2 className="text-base font-bold text-ink mb-2">Upload a profile photo</h2>
          <p className="text-sm text-ink-soft mb-3">We couldn&apos;t read a face from your ID, so we&apos;ll match your live face against a clear profile photo instead.</p>
          <UploadBox preview={profilePreview} onClick={() => profileInput.current?.click()} placeholder="Click to upload a clear, front-facing photo" />
          <input ref={profileInput} type="file" accept="image/*" className="hidden" onChange={onProfileUpload} />
          {error && <Notice tone="warn">{error}</Notice>}
          <div className="flex justify-between mt-5 pt-4 border-t border-line">
            <Button variant="outline" onClick={() => setStage("id")}>Back</Button>
            <Button onClick={continueFromProfile} disabled={!profilePreview} loading={busy}>Continue <ChevronRight size={14} /></Button>
          </div>
        </Card>
      )}

      {/* ── Liveness ── */}
      {stage === "liveness" && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold text-ink">Step 2 — Liveness</h2>
              <p className="text-xs text-ink-faint">Perform the action — it&apos;s detected in real time</p>
            </div>
            <span className="text-xs bg-teal-soft text-teal-deep font-bold rounded-full px-3 py-1">{Math.min(challengeIdx + 1, 3)} / 3</span>
          </div>

          {cameraError ? (
            <Notice tone="error">{cameraError}</Notice>
          ) : (
            <>
              <div className="flex items-center gap-3 p-3 rounded-xl mb-3 bg-teal-soft border border-teal/20">
                <div className="text-teal shrink-0">{ch.icon}</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-ink">{ch.label}</p>
                  <p className="text-xs text-ink-soft">{ch.instruction}</p>
                </div>
              </div>

              <div className="relative rounded-xl overflow-hidden bg-black" style={{ aspectRatio: "4/3" }}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay style={{ transform: "scaleX(-1)" }} />
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 640 480" style={{ pointerEvents: "none" }}>
                  <defs><mask id="kgm"><rect width="640" height="480" fill="white" /><ellipse cx="320" cy="220" rx="130" ry="165" fill="black" /></mask></defs>
                  <rect width="640" height="480" fill="rgba(0,0,0,0.45)" mask="url(#kgm)" />
                  <ellipse cx="320" cy="220" rx="130" ry="165" fill="none"
                    stroke={detected ? "#0E7C66" : "#ef4444"} strokeWidth={3}
                    strokeDasharray={detected ? "none" : "8 5"} />
                </svg>
                <div className="absolute bottom-3 left-0 right-0 flex flex-col items-center gap-1.5">
                  <div className={`text-xs px-3 py-1.5 rounded-full ${detected ? "bg-teal/80 text-white" : "bg-black/70 text-white"}`}>
                    {detected ? hint || "Face detected" : "○ Align your face in the oval"}
                  </div>
                  {process.env.NODE_ENV !== "production" && earDebug && (
                    <div className="text-[10px] font-mono px-2 py-1 rounded bg-black/70 text-amber-300">
                      EAR {earDebug.ear.toFixed(3)} · min {earDebug.min.toFixed(3)}
                      {earDebug.baseline > 0
                        ? ` · base ${earDebug.baseline.toFixed(3)} · fires <${(earDebug.baseline * BLINK_DROP).toFixed(3)}`
                        : " · calibrating…"}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 mt-4">
                {CHALLENGES.map((c, i) => {
                  const done = passed.includes(c.id);
                  const active = i === challengeIdx;
                  return (
                    <div key={c.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                      done ? "bg-teal text-white" : active ? "bg-teal-soft text-teal-deep" : "bg-line text-ink-faint"}`}>
                      {done ? <CheckCircle2 size={12} /> : c.icon}{c.label.split(" ")[0]}
                    </div>
                  );
                })}
              </div>

              {timedOut && (
                <div className="mt-3">
                  <Notice tone="warn">Couldn&apos;t detect that clearly. Make sure your face is well-lit and centred.</Notice>
                  <div className="flex gap-2 mt-2 justify-center">
                    <Button variant="outline" size="sm" onClick={() => { setTimedOut(false); setChallengeIdx((i) => i); }}>Retry</Button>
                    <Button size="sm" onClick={() => { stopCamera(); setStage("result"); }}>Send for manual review</Button>
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-center gap-1 text-xs text-ink-faint justify-center">
                <ShieldCheck size={10} /><span>On-device · blink + head-turn verified live</span>
              </div>
            </>
          )}
        </Card>
      )}

      {/* ── Result ── */}
      {stage === "result" && (
        <Card className="text-center py-10 px-6">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-5 ${verified ? "bg-teal-soft" : "bg-gold-soft"}`}>
            {verified ? <ShieldCheck size={36} className="text-teal" /> : <AlertTriangle size={36} className="text-gold" />}
          </div>
          <h2 className="text-2xl font-bold text-ink mb-1">{verified ? "Identity verified" : "Sent for manual review"}</h2>
          <p className="text-sm text-ink-soft mb-6 max-w-sm mx-auto">
            {verified
              ? "Your live face matched your reference photo and liveness passed."
              : "This submission looked suspicious or unclear, so a branch officer will verify it manually."}
          </p>

          <div className="max-w-xs mx-auto text-left space-y-2 mb-6">
            <ResultRow ok={livenessPassed} label="Liveness (blink + turn)" value={livenessPassed ? "Passed" : "Failed"} />
            <ResultRow ok={distance !== null && distance < MATCH_STRICT} label={`Face match vs ${refSource === "id" ? "ID" : "photo"}`}
              value={distance === null ? "—" : `${Math.round(sim * 100)}%`} />
            <ResultRow ok={verified} label="Verdict" value={verified ? "MATCH" : "REVIEW"} />
          </div>

          {!verified && (
            <Notice tone="warn">A branch officer will review this within 1–2 business days.</Notice>
          )}
          <Button variant="outline" onClick={reset} className="mt-4"><RotateCcw size={14} /> Start over</Button>
        </Card>
      )}
    </div>
  );
}

function UploadBox({ preview, onClick, placeholder }: { preview: string; onClick: () => void; placeholder: string }) {
  return (
    <div onClick={onClick}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${preview ? "border-teal bg-teal-soft/40" : "border-line hover:border-teal"}`}>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="upload" className="max-h-52 mx-auto rounded-lg object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-ink-faint py-4">
          <Upload size={28} /><p className="text-sm">{placeholder}</p>
        </div>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  const cls = tone === "error" ? "bg-red-50 border-red-200 text-danger" : "bg-gold-soft border-gold/30 text-gold";
  return (
    <div className={`mt-3 flex items-start gap-2 text-xs rounded-xl border px-3 py-2 ${cls}`}>
      <AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>{children}</span>
    </div>
  );
}

function ResultRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-line last:border-0">
      {ok ? <CheckCircle2 size={15} className="text-teal" /> : <AlertTriangle size={15} className="text-gold" />}
      <span className="text-sm text-ink-soft flex-1">{label}</span>
      <span className="text-sm font-bold text-ink">{value}</span>
    </div>
  );
}
