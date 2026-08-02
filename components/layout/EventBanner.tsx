"use client";

import { useCallback, useEffect, useState } from "react";

import { useTenant } from "@/lib/providers/TenantProvider";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";
type EventRow = {
  id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
};

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

export default function EventBanner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const { tenant } = useTenant();

  const loadActiveEvent = useCallback(async (canUpdate: () => boolean) => {
    const { data, error } = await supabase
      .from("events")
      .select("id,name,location,start_date,end_date")
      .eq("is_active", true)
      .eq("is_master_map", false)
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Could not load active event:", error.message);
      return;
    }

    if (canUpdate()) {
      setEvent(data || null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const canUpdate = () => !cancelled;
    void loadActiveEvent(canUpdate);

    const intervalId = window.setInterval(() => {
      void loadActiveEvent(canUpdate);
    }, 30000);

    function handleFocus() {
      void loadActiveEvent(canUpdate);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void loadActiveEvent(canUpdate);
      }
    }

    function handleStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEYS.activeEventChanged) {
        void loadActiveEvent(canUpdate);
      }
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadActiveEvent]);

  alert(JSON.stringify(tenant, null, 2));
  if (!event) {
    return null;
  }

  const dateRange = formatDateRange(event.start_date, event.end_date);

  return (
    <div
      style={{
        padding: "14px 24px",
        borderBottom: "1px solid #ddd",
        background: "#fafafa",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {tenant?.logoUrl && (
          <img
            src={tenant.logoUrl}
            alt={tenant.organizationName}
            style={{
              width: 40,
              height: 40,
              objectFit: "contain",
              flexShrink: 0,
            }}
          />
        )}

        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{event.name}</div>

          {event.location && (
            <div style={{ fontSize: 14, color: "#666" }}>{event.location}</div>
          )}

          {dateRange && (
            <div style={{ fontSize: 13, color: "#888" }}>{dateRange}</div>
          )}
        </div>
      </div>
    </div>
  );
}
