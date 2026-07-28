"use client";

import { useEffect, useState } from "react";
import { hqChainBlocks, hqChainSeal, hqChainVerify, type ChainBlock } from "@/lib/api";
import { Card, Button, Badge, Spinner, StatCard } from "@/components/ui";
import { Blocks, ShieldCheck, AlertTriangle, Pickaxe, Link2, Hash, CheckCircle2 } from "lucide-react";

const short = (h: string, n = 10) => (h.length > n ? `${h.slice(0, n)}…${h.slice(-4)}` : h);

export default function ChainPage() {
  const [blocks, setBlocks] = useState<ChainBlock[] | null>(null);
  const [pending, setPending] = useState(0);
  const [verify, setVerify] = useState<{ valid: boolean; blocks_verified: number; message: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sealing, setSealing] = useState(false);
  const [justMined, setJustMined] = useState<number | null>(null);

  const load = () =>
    Promise.all([hqChainBlocks(), hqChainVerify()])
      .then(([b, v]) => { setBlocks(b.blocks); setPending(b.pending); setVerify(v); })
      .catch((e) => setError(e.message));

  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const seal = async () => {
    setSealing(true); setError(""); setJustMined(null);
    try {
      const r = await hqChainSeal();
      setJustMined(r.block.index);
      await load();
      setTimeout(() => setJustMined(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seal failed");
    } finally {
      setSealing(false);
    }
  };

  if (loading) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  if (error && !blocks) return <div className="text-danger p-6">{error}</div>;
  if (!blocks) return null;

  const head = blocks[0];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-[#0c1626] p-6 text-white shadow-lift">
        <div className="flex items-center gap-2 mb-1.5 text-teal">
          <Blocks size={18} />
          <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Tamper-evident · Hash-linked blocks</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Blockchain Ledger</h1>
        <p className="mt-1 text-white/55 text-sm">Transactions batched into hash-linked, Merkle-rooted blocks. Alter any past transaction and the chain breaks.</p>
      </div>

      {/* Integrity */}
      {verify && (
        <div className={`rounded-2xl border px-5 py-4 flex items-center gap-3 ${verify.valid ? "bg-teal-soft border-teal/20" : "bg-red-50 border-red-200"}`}>
          {verify.valid ? <ShieldCheck size={22} className="text-teal" /> : <AlertTriangle size={22} className="text-danger" />}
          <div className="flex-1">
            <p className={`font-semibold ${verify.valid ? "text-teal-deep" : "text-danger"}`}>{verify.message}</p>
            <p className="text-xs text-ink-soft">{verify.blocks_verified} block(s) re-hashed and link-checked</p>
          </div>
          <Badge variant={verify.valid ? "success" : "danger"}>{verify.valid ? "INTACT" : "BROKEN"}</Badge>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Chain height" value={blocks.length} sub={`head block #${head?.index ?? 0}`} icon={<Blocks size={18} />} color="teal" />
        <StatCard label="Pending transactions" value={pending} sub="awaiting a block" icon={<Hash size={18} />} color="gold" />
        <StatCard label="PoW difficulty" value={head ? `${head.difficulty} zeros` : "—"} icon={<Pickaxe size={18} />} color="teal" />
      </div>

      {/* Seal */}
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Seal a new block</h2>
            <p className="text-sm text-ink-soft">{pending > 0 ? `${pending} transaction(s) ready to be mined into the next block.` : "No pending transactions — make a transfer or payment first."}</p>
          </div>
          <Button onClick={seal} loading={sealing} disabled={pending === 0}>
            <Pickaxe size={15} />{sealing ? "Mining…" : "Mine & seal block"}
          </Button>
        </div>
        {justMined !== null && (
          <div className="mt-3 rounded-xl bg-teal-soft border border-teal/20 text-teal-deep px-4 py-3 text-sm flex items-center gap-2">
            <CheckCircle2 size={16} /> Block #{justMined} mined and appended to the chain.
          </div>
        )}
        {error && blocks && <div className="mt-3 text-sm text-danger">{error}</div>}
      </Card>

      {/* Explorer */}
      <div>
        <p className="text-[11px] font-bold text-ink-faint uppercase tracking-widest mb-3">Block explorer</p>
        <div className="space-y-2">
          {blocks.map((b) => (
            <Card key={b.index} className="p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-ink text-white flex items-center justify-center font-display font-bold">
                    {b.index}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <Hash size={12} className="text-teal" />
                      <span className="font-mono text-sm text-ink">{short(b.hash, 16)}</span>
                      {b.index === 0 && <Badge variant="default">genesis</Badge>}
                    </div>
                    <p className="text-xs text-ink-faint flex items-center gap-1 mt-1">
                      <Link2 size={11} /> prev <span className="font-mono">{short(b.prev_hash)}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-5 text-right">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-ink-faint">Txns</p>
                    <p className="font-semibold text-ink nums">{b.tx_count}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-ink-faint">Nonce</p>
                    <p className="font-semibold text-ink nums">{b.nonce.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-ink-faint">Time</p>
                    <p className="font-semibold text-ink text-xs">{b.timestamp.slice(0, 19).replace("T", " ")}</p>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-ink-faint mt-2 font-mono flex items-center gap-1">
                <span className="text-ink-soft">merkle root</span> {short(b.merkle_root, 24)}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
