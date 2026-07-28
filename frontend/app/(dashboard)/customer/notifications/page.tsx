"use client";

import { useState, useEffect, useCallback } from "react";
import { listNotifications, markNotificationsRead, type Notification } from "@/lib/api";
import { Card, Button, Badge, Spinner, EmptyState } from "@/components/ui";
import { Bell, CheckCheck } from "lucide-react";

export default function NotificationsPage() {
  const [data, setData] = useState<{ notifications: Notification[]; unread: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listNotifications().then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const markRead = async () => {
    await markNotificationsRead().catch(() => {});
    load();
  };

  if (error) return <div className="text-danger p-6">{error}</div>;
  if (!data) return <div className="flex justify-center p-12"><Spinner /></div>;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-ink flex items-center gap-2">
          <Bell size={16} /> Notifications {data.unread > 0 && <Badge variant="danger">{data.unread} new</Badge>}
        </h2>
        {data.unread > 0 && <Button size="sm" variant="outline" onClick={markRead}><CheckCheck size={14} /> Mark all read</Button>}
      </div>
      {data.notifications.length === 0 ? <EmptyState message="No notifications." /> : (
        <div className="space-y-2">
          {data.notifications.map((n) => (
            <div key={n.id} className={`flex items-start gap-3 p-3 rounded-lg border ${n.read ? "border-line" : "border-teal/40 bg-teal-soft/30"}`}>
              <Badge variant={n.read ? "default" : "info"}>{n.type}</Badge>
              <div className="flex-1">
                <p className="text-sm text-ink">{n.message}</p>
                <p className="text-xs text-ink-soft">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
