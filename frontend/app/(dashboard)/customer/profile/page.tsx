"use client";

import { useEffect, useState } from "react";
import { getProfile, updateProfile, type UserProfile } from "@/lib/api";
import { Card, Button, Spinner } from "@/components/ui";
import { CheckCircle, AlertCircle, Edit2, Save, X } from "lucide-react";

const PROVINCES = ["Bagmati", "Gandaki", "Lumbini", "Koshi", "Madhesh", "Karnali", "Sudurpashchim"];

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [district, setDistrict] = useState("");
  const [province, setProvince] = useState("");
  const [occupation, setOccupation] = useState("");

  useEffect(() => {
    getProfile()
      .then(p => {
        setProfile(p);
        setFullName(p.full_name);
        setAddress(p.address ?? "");
        setDistrict(p.district ?? "");
        setProvince(p.province ?? "");
        setOccupation(p.occupation ?? "");
      })
      .catch(e => setMsg({ ok: false, text: e.message }))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setMsg(null);
    try {
      await updateProfile({ full_name: fullName, address, district, province, occupation });
      setProfile(p => p ? { ...p, full_name: fullName, address, district, province, occupation } : p);
      setMsg({ ok: true, text: "Profile updated successfully" });
      setEditing(false);
    } catch (e: unknown) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Update failed" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink">My Profile</h1>
          <p className="text-sm text-ink-soft mt-0.5">Your personal and account information</p>
        </div>
        {!editing
          ? <Button variant="outline" onClick={() => setEditing(true)}><Edit2 size={14} className="mr-1.5" />Edit</Button>
          : <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>{saving ? <Spinner size="sm" /> : <><Save size={14} className="mr-1.5" />Save</>}</Button>
              <Button variant="outline" onClick={() => setEditing(false)}><X size={14} /></Button>
            </div>
        }
      </div>

      {msg && (
        <div className={`flex items-center gap-3 p-3 rounded-xl border ${msg.ok ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
          {msg.ok ? <CheckCircle size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-red-500" />}
          <p className={`text-sm ${msg.ok ? "text-emerald-800" : "text-red-700"}`}>{msg.text}</p>
        </div>
      )}

      {profile && (
        <>
          <Card>
            <div className="flex items-center gap-4 mb-5">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal to-teal-deep flex items-center justify-center text-2xl font-black text-white">
                {profile.full_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="text-xl font-bold text-ink">{profile.full_name}</p>
                <p className="text-sm text-ink-soft">@{profile.username}</p>
                <p className="text-xs text-ink-faint capitalize mt-0.5">{profile.role} · {profile.is_active ? "Active" : "Inactive"}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" editing={editing} value={fullName} onChange={setFullName} locked={false} />
              <Field label="Username" editing={false} value={profile.username} onChange={() => {}} locked={true} />
              <Field label="Date of Birth" editing={false} value={profile.date_of_birth ?? "—"} onChange={() => {}} locked={true} />
              <Field label="Gender" editing={false} value={profile.gender ?? "—"} onChange={() => {}} locked={true} />
              <Field label="Nationality" editing={false} value={profile.nationality} onChange={() => {}} locked={true} />
              <Field label="National ID" editing={false} value={profile.national_id ?? "—"} onChange={() => {}} locked={true} />
            </div>
          </Card>

          <Card>
            <h2 className="font-bold text-ink mb-4">Address & Employment</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Field label="Address" editing={editing} value={address} onChange={setAddress} locked={false} />
              </div>
              <Field label="District" editing={editing} value={district} onChange={setDistrict} locked={false} />
              {editing ? (
                <div>
                  <label className="block text-xs font-medium text-ink-soft mb-1">Province</label>
                  <select value={province} onChange={e => setProvince(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                    <option value="">Select province</option>
                    {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              ) : (
                <Field label="Province" editing={false} value={province || "—"} onChange={() => {}} locked={false} />
              )}
              <Field label="Occupation" editing={editing} value={occupation} onChange={setOccupation} locked={false} />
              <Field label="Annual Income" editing={false} value={profile.annual_income ? `NPR ${profile.annual_income.toLocaleString()}` : "—"} onChange={() => {}} locked={true} />
            </div>
          </Card>

          <Card>
            <h2 className="font-bold text-ink mb-3">Account Activity</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-ink-faint">Last Login</p><p className="font-medium">{profile.last_login ? new Date(profile.last_login).toLocaleString("en-NP") : "—"}</p></div>
              <div><p className="text-xs text-ink-faint">Member Since</p><p className="font-medium">{profile.created_at ? new Date(profile.created_at).toLocaleDateString("en-NP") : "—"}</p></div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Field({ label, editing, value, onChange, locked }: {
  label: string; editing: boolean; value: string; onChange: (v: string) => void; locked: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-soft mb-1">{label}</label>
      {editing && !locked ? (
        <input value={value} onChange={e => onChange(e.target.value)}
          className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
      ) : (
        <p className={`text-sm font-medium py-2 ${locked ? "text-ink-faint" : "text-ink"}`}>{value || "—"}</p>
      )}
    </div>
  );
}
