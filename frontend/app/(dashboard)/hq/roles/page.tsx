"use client";

import { useState, useEffect, useCallback } from "react";
import {
  adminPermissionCatalog,
  adminGetRolePerms,
  adminSetRolePerms,
  type PermissionDef,
} from "@/lib/api";
import { Card, Button, Badge, Spinner } from "@/components/ui";
import { KeySquare, Save } from "lucide-react";

const EDITABLE_ROLES = ["ceo", "it_admin", "branch_manager", "cashier", "customer", "viewer"];

export default function RolesPage() {
  const [catalog, setCatalog] = useState<PermissionDef[] | null>(null);
  const [role, setRole] = useState("cashier");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    adminPermissionCatalog().then((r) => setCatalog(r.permissions)).catch((e) => setError(e.message));
  }, []);

  const loadRole = useCallback((r: string) => {
    setSavedMsg("");
    adminGetRolePerms(r).then((res) => setSelected(new Set(res.permissions))).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { loadRole(role); }, [role, loadRole]);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminSetRolePerms(role, Array.from(selected));
      setSavedMsg(`Saved ${selected.size} permissions for ${role}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !catalog) return <div className="text-danger p-6">{error}</div>;
  if (!catalog) return <div className="flex justify-center p-12"><Spinner /></div>;

  const categories = Array.from(new Set(catalog.map((p) => p.Category)));

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2"><KeySquare size={16} /> Role permission matrix</h2>
          <div className="flex items-center gap-3">
            <select className="rounded-lg border border-line px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}>
              {EDITABLE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <Button onClick={save} loading={saving}><Save size={14} /> Save</Button>
          </div>
        </div>
        <p className="text-xs text-ink-soft mb-2">The <code>admin</code> role is a fixed superuser and cannot be edited. Changes apply immediately to all users with this role.</p>
        {error && <p className="text-danger text-xs">{error}</p>}
        {savedMsg && <p className="text-emerald-600 text-xs">{savedMsg}</p>}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {categories.map((cat) => (
          <Card key={cat}>
            <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-3">{cat}</h3>
            <div className="space-y-2">
              {catalog.filter((p) => p.Category === cat).map((p) => (
                <label key={p.Key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={selected.has(p.Key)} onChange={() => toggle(p.Key)} className="accent-teal" />
                  <span>{p.Label}</span>
                  <Badge variant="default">{p.Key}</Badge>
                </label>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
