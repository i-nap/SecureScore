"use client";

import { useState, useEffect, useCallback } from "react";
import { adminListBranches, adminCreateBranch, type AdminBranch } from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { MapPin, Plus } from "lucide-react";

const TYPES = ["urban", "semi_urban", "rural"];

export default function BranchesPage() {
  const [branches, setBranches] = useState<AdminBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", branch_type: "urban", district: "" });

  const load = useCallback(() => {
    adminListBranches().then((r) => setBranches(r.branches)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminCreateBranch(form);
      setForm({ name: "", branch_type: "urban", district: "" });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !branches) return <div className="text-danger p-6">{error}</div>;
  if (!branches) return <div className="flex justify-center p-12"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2"><Plus size={16} /> Add branch</h2>
        {error && <p className="text-danger text-xs mb-3">{error}</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="branch name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="rounded-lg border border-line px-3 py-2 text-sm" value={form.branch_type} onChange={(e) => setForm({ ...form, branch_type: e.target.value })}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="district" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />
          <Button onClick={create} loading={saving} disabled={!form.name}>Add</Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2"><MapPin size={16} /> Branches ({branches.length})</h2>
        {branches.length === 0 ? <EmptyState message="No branches yet." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-soft border-b border-line">
                  <th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">District</th><th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.name} className="border-b border-line/50">
                    <td className="py-2 pr-4 font-medium">{b.name}</td>
                    <td className="py-2 pr-4"><Badge variant="info">{b.branch_type}</Badge></td>
                    <td className="py-2 pr-4">{b.district || "—"}</td>
                    <td className="py-2"><Badge variant={b.active ? "success" : "danger"}>{b.active ? "active" : "inactive"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
