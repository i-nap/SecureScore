"use client";

import { useRef, useState } from "react";
import { scanHandwriting, type HandwritingResult } from "@/lib/api";
import { Card, Button, Badge, Spinner } from "@/components/ui";
import { PenLine, Upload, Copy, Download, AlertTriangle, Sparkles } from "lucide-react";

export default function HandwritingPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<HandwritingResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    setFile(f);
    setResult(null);
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function scan() {
    if (!file) return;
    setScanning(true);
    setError(null);
    try {
      setResult(await scanHandwriting(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Digitisation failed");
    } finally {
      setScanning(false);
    }
  }

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    if (!result) return;
    const blob = new Blob([result.text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "digitised.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <PenLine size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Handwriting → text · On-device</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Handwriting OCR</h1>
        <p className="mt-1 text-white/55 text-sm">Digitise a handwritten letter or form. The image is read on this branch&apos;s device — it never leaves the branch.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* Upload */}
        <Card>
          <div
            onClick={() => fileInput.current?.click()}
            className="border-2 border-dashed border-line rounded-xl p-6 text-center cursor-pointer hover:border-teal transition-colors"
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="handwriting" className="max-h-72 mx-auto rounded-lg" />
            ) : (
              <div className="text-ink-faint py-8">
                <Upload size={28} className="mx-auto mb-2" />
                <p className="text-sm">Click to choose an image of handwritten text</p>
              </div>
            )}
            <input ref={fileInput} type="file" accept="image/*" className="hidden"
              onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          </div>
          {file && (
            <Button className="mt-4 w-full" onClick={scan} loading={scanning} disabled={scanning}>
              <PenLine size={16} />{scanning ? "Reading handwriting…" : "Digitise"}
            </Button>
          )}
          {error && (
            <div className="mt-3 flex items-center gap-2 text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle size={15} /> {error}
            </div>
          )}
        </Card>

        {/* Result */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-semibold text-ink">Digitised text</h2>
            {result && (
              <div className="flex items-center gap-2">
                <Badge variant={result.engine === "trocr" ? "success" : "default"}>
                  <Sparkles size={11} />{result.engine === "trocr" ? "TrOCR" : "EasyOCR"}
                </Badge>
                <Badge variant="info">{Math.round(result.overall_confidence * 100)}%</Badge>
              </div>
            )}
          </div>

          {!result ? (
            <div className="flex items-center justify-center h-48 text-ink-faint text-sm">
              {scanning ? <Spinner /> : "Upload an image and press Digitise."}
            </div>
          ) : (
            <>
              <textarea
                value={result.text}
                readOnly
                rows={10}
                className="w-full border border-line rounded-xl px-3 py-2.5 text-sm bg-canvas/60 resize-none"
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-ink-faint">{result.line_count} line{result.line_count === 1 ? "" : "s"} recognised</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copy}><Copy size={14} />{copied ? "Copied" : "Copy"}</Button>
                  <Button variant="outline" size="sm" onClick={download}><Download size={14} />.txt</Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
