"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AnnouncementBanner from "@/components/AnnouncementBanner";
import { supabase } from "@/lib/supabase";

type EventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type DashboardVendor = {
  id: string;
  business_name: string;
  business_description: string | null;
  logo_url: string | null;
  signup_url: string | null;
  is_featured: boolean | null;
  action_type: string | null;
};

export default function MemberDashboardPage() {
  const [ready, setReady] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [vendors, setVendors] = useState<DashboardVendor[]>([]);
  const [currentVendorIndex, setCurrentVendorIndex] = useState(0);

  useEffect(() => {
    try {
      const rawEvent = localStorage.getItem("fcoc-member-event-context");
      const attendeeId = localStorage.getItem("fcoc-member-attendee-id");
      const entryId = localStorage.getItem("fcoc-member-entry-id");
      const email = localStorage.getItem("fcoc-member-email");

      if (!rawEvent) {
        window.location.href = "/member/login";
        return;
      }

      if (!attendeeId && !entryId && !email) {
        window.location.href = "/member/login";
        return;
      }

      const parsed = JSON.parse(rawEvent);
      setCurrentEvent(parsed);
    } catch (err) {
      console.error("Member dashboard load error:", err);
      window.location.href = "/member/login";
      return;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    async function loadVendors() {
      try {
        const rawEvent = localStorage.getItem("fcoc-member-event-context");
        if (!rawEvent) {
          return;
        }

        const event = JSON.parse(rawEvent);

        const { data, error } = await supabase
          .from("event_vendors")
          .select(
            `
          id,
          is_featured,
          display_order,
          signup_url,
          action_type,
          vendors (
            id,
            business_name,
            business_description,
            logo_url
          )
        `,
          )
          .eq("event_id", event.id)
          .eq("is_visible_to_members", true)
          .order("display_order", { ascending: true });

        if (error) {
          throw error;
        }

        const cleaned =
          (data || [])
            .filter((row: any) => row.vendors)
            .map((row: any) => ({
              id: row.vendors.id,
              business_name: row.vendors.business_name,
              business_description: row.vendors.business_description,
              logo_url: row.vendors.logo_url,
              signup_url: row.signup_url,
              is_featured: row.is_featured,
              action_type: row.action_type || "service_request",
            })) || [];

        setVendors(cleaned);
        setCurrentVendorIndex(0);
      } catch (err) {
        console.error("Vendor load error:", err);
      }
    }

    void loadVendors();
  }, []);

  useEffect(() => {
    if (vendors.length <= 1) {
      return;
    }

    const interval = setInterval(() => {
      setCurrentVendorIndex((prev) =>
        prev + 1 >= vendors.length ? 0 : prev + 1,
      );
    }, 5000);

    return () => clearInterval(interval);
  }, [vendors]);

  if (!ready) {
    return <div style={{ padding: 30 }}>Loading...</div>;
  }

  if (!currentEvent) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: 18, padding: 16 }}>
      <AnnouncementBanner />

      <div
        className="card"
        style={{
          padding: 18,
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "#fff",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>
          {currentEvent.name || currentEvent.eventName || "Member Dashboard"}
        </h1>

        <div style={{ fontSize: 14, opacity: 0.8 }}>
          {currentEvent.location || ""}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <Link
          href="/member/agenda"
          className="dashboard-nav-button dashboard-nav-agenda"
        >
          📅 Agenda
        </Link>

        <Link
          href="/member/announcements"
          className="dashboard-nav-button dashboard-nav-announcements"
        >
          📢 Announcements
        </Link>

        <Link
          href="/member/attendees"
          className="dashboard-nav-button dashboard-nav-attendees"
        >
          👥 Attendees
        </Link>

        <Link
          href="/member/nearby"
          className="dashboard-nav-button dashboard-nav-nearby"
        >
          📍 Nearby
        </Link>
      </div>

      {vendors.length > 0 ? (
        <div
          className="card"
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "white",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 10 }}>
            Event Vendors
          </div>

          {(() => {
            const vendor = vendors[currentVendorIndex] || vendors[0];

            if (!vendor) {
              return null;
            }

            return (
              <div style={{ display: "grid", gap: 10, textAlign: "center" }}>
                {vendor.logo_url ? (
                  <img
                    src={vendor.logo_url}
                    alt={vendor.business_name}
                    style={{
                      maxHeight: 90,
                      maxWidth: "100%",
                      objectFit: "contain",
                      margin: "0 auto",
                    }}
                  />
                ) : null}

                <div style={{ fontWeight: 800, fontSize: 20 }}>
                  {vendor.business_name}
                </div>

                {vendor.business_description ? (
                  <div
                    style={{ fontSize: 14, color: "#555", lineHeight: 1.45 }}
                  >
                    {vendor.business_description}
                  </div>
                ) : null}

                {vendor.action_type === "external_signup" &&
                vendor.signup_url ? (
                  <a
                    href={vendor.signup_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={primaryLinkStyle}
                  >
                    Sign Up
                  </a>
                ) : vendor.action_type === "info_only" ? (
                  <Link href="/member/vendor-signup" style={primaryLinkStyle}>
                    View Vendors
                  </Link>
                ) : (
                  <Link
                    href={`/member/vendor-signup?vendorId=${vendor.id}`}
                    style={primaryLinkStyle}
                  >
                    Request Service
                  </Link>
                )}
              </div>
            );
          })()}

          {vendors.length > 1 ? (
            <div style={{ marginTop: 12, textAlign: "center" }}>
              {vendors.map((vendor, index) => (
                <button
                  key={vendor.id}
                  type="button"
                  aria-label={`Show vendor ${index + 1}`}
                  onClick={() => setCurrentVendorIndex(index)}
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    margin: "0 4px",
                    padding: 0,
                    border: "none",
                    background:
                      index === currentVendorIndex ? "#0b5cff" : "#ccc",
                    cursor: "pointer",
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const cardLinkStyle = {
  display: "block",
  padding: "16px 18px",
  border: "1px solid #ddd",
  borderRadius: 10,
  textDecoration: "none",
  color: "#111",
  background: "white",
  fontWeight: 700,
  textAlign: "center" as const,
};

const primaryLinkStyle = {
  display: "inline-block",
  width: "fit-content",
  margin: "6px auto 0",
  padding: "10px 14px",
  borderRadius: 8,
  background: "#0b5cff",
  color: "#fff",
  textDecoration: "none",
  fontWeight: 700,
};
