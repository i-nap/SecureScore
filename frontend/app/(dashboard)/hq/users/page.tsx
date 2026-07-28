"use client";

import { useState, useEffect, useCallback } from "react";
import {
  adminListUsers,
  adminCreateUser,
  adminUpdateUser,
  adminListBranches,
  type AdminUser,
} from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { UserPlus, RefreshCw } from "lucide-react";

const ROLES = ["admin", "ceo", "it_admin", "branch_manager", "cashier", "customer", "viewer"];

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    username: "", password: "", role: "cashier", branch_id: "", full_name: "", email: "", customer_id: "",
  });

  const load = useCallback(() => {
    adminListUsers().then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  // "hq" is what admin/ceo/it_admin accounts carry, but it is not a row in the
  // branches table — offer it explicitly or those users become uncreatable here.
  useEffect(() => {
    adminListBranches()
      .then((r) => setBranches(["hq", ...r.branches.map((b) => b.name)]))
      .catch(() => setBranches(["hq"]));
  }, []);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminCreateUser(form);
      setForm({ ...form, username: "", password: "", full_name: "", email: "", customer_id: "" });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: AdminUser) => {
    await adminUpdateUser(u.username, { active: !u.active }).catch((e) => setError((e as Error).message));
    load();
  };

  if (error && !users) return <div className="text-danger p-6">{error}</div>;
  if (!users) return <div className="flex justify-center p-12"><Spinner /></div>;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2">
          <UserPlus size={16} /> Create user
        </h2>
        {error && <p className="text-danger text-xs mb-3">{error}</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="username" value={form.username} onChange={set("username")} />
          <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="password" type="password" value={form.password} onChange={set("password")} />
          <select className="rounded-lg border border-line px-3 py-2 text-sm" value={form.role} onChange={set("role")}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="rounded-lg border border-line px-3 py-2 text-sm" value={form.branch_id} onChange={set("branch_id")}>
            <option value="">— no branch —</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="full name" value={form.full_name} onChange={set("full_name")} />
          <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="email" value={form.email} onChange={set("email")} />
          <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="customer_id (optional)" value={form.customer_id} onChange={set("customer_id")} />
          <Button onClick={create} loading={saving} disabled={!form.username || !form.password}>Create</Button>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink">Users ({users.length})</h2>
          <button onClick={load} className="flex items-center gap-1 text-xs text-ink-soft hover:text-ink"><RefreshCw size={14} /> Refresh</button>
        </div>
        {users.length === 0 ? <EmptyState message="No users yet." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-soft border-b border-line">
                  <th className="py-2 pr-4">Username</th><th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">Branch</th><th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Status</th><th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.username} className="border-b border-line/50">
                    <td className="py-2 pr-4 font-mono text-xs">{u.username}</td>
                    <td className="py-2 pr-4"><Badge variant="info">{u.role}</Badge></td>
                    <td className="py-2 pr-4">{u.branch_id || "—"}</td>
                    <td className="py-2 pr-4">{u.full_name || "—"}</td>
                    <td className="py-2 pr-4"><Badge variant={u.active ? "success" : "danger"}>{u.active ? "active" : "disabled"}</Badge></td>
                    <td className="py-2">
                      <Button size="sm" variant={u.active ? "outline" : "primary"} onClick={() => toggleActive(u)}>
                        {u.active ? "Disable" : "Enable"}
                      </Button>
                    </td>
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
