"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

type VendorRow = {
  id: string;
  business_name: string | null;
  access_token: string | null;
  access_token_expires_at?: string | null;
  vendor_portal_enabled?: boolean | null;
};

type RequestRow = {
  id: string;
  vendor_id: string | null;
  requester_name: string | null;
  requester_phone: string | null;
  requester_email: string | null;
  requested_service: string | null;
  guest_count: number | null;
  site_number: string | null;
  request_notes: string | null;
  request_status: string | null;
  created_at: string | null;
};

function tokenIsExpired(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const expiresAt = new Date(value).getTime();
  return Number.isFinite(expiresAt) && expiresAt < Date.now();
}

function VendorRequestsInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [vendor, setVendor] = useState<VendorRow | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [status, setStatus] = useState("Loading...");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!token) {
        setVendor(null);
        setRequests([]);
        setStatus("Missing access token.");
        return;
      }

      const { data: vendorRow, error: vendorError } = await supabase
        .from("vendors")
        .select(
          "id,business_name,access_token,access_token_expires_at,vendor_portal_enabled",
        )
        .eq("access_token", token)
        .maybeSingle();

      if (vendorError) {
        console.error(vendorError);
        setVendor(null);
        setRequests([]);
        setStatus("Error validating vendor link.");
        return;
      }

      const typedVendor = vendorRow as VendorRow | null;

      if (!typedVendor?.id) {
        setVendor(null);
        setRequests([]);
        setStatus("This vendor link is not valid.");
        return;
      }

      if (typedVendor.vendor_portal_enabled === false) {
        setVendor(typedVendor);
        setRequests([]);
        setStatus("This vendor link has been disabled.");
        return;
      }

      if (tokenIsExpired(typedVendor.access_token_expires_at)) {
        setVendor(typedVendor);
        setRequests([]);
        setStatus(
          "This vendor link has expired. Please contact the event team.",
        );
        return;
      }

      setVendor(typedVendor);

      const { data, error } = await supabase
        .from("vendor_service_requests")
        .select(
          `
          id,
          vendor_id,
          requester_name,
          requester_phone,
          requester_email,
          requested_service,
          guest_count,
          site_number,
          request_notes,
          request_status,
          created_at
        `,
        )
        .eq("vendor_id", typedVendor.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        setRequests([]);
        setStatus("Error loading requests.");
        return;
      }

      setRequests((data || []) as RequestRow[]);
      setStatus(`Loaded ${data?.length || 0} requests`);
    }

    void load();
  }, [token]);

  async function updateRequestStatus(requestId: string, nextStatus: string) {
    if (!vendor?.id) {
      setStatus("Vendor link is not valid.");
      return;
    }

    try {
      setUpdatingId(requestId);
      setStatus("Updating request...");

      const { error } = await supabase
        .from("vendor_service_requests")
        .update({ request_status: nextStatus })
        .eq("id", requestId)
        .eq("vendor_id", vendor.id);

      if (error) {
        throw error;
      }

      setRequests((prev) =>
        prev.map((request) =>
          request.id === requestId
            ? { ...request, request_status: nextStatus }
            : request,
        ),
      );
      setStatus("Request updated.");
    } catch (err: any) {
      console.error("update vendor request status error:", err);
      setStatus(err?.message || "Could not update request.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div style={{ padding: 20, display: "grid", gap: 16 }}>
      <h1>My Service Requests</h1>
      {vendor?.business_name ? (
        <div style={{ fontWeight: 800 }}>{vendor.business_name}</div>
      ) : null}
      <div style={{ fontSize: 14, opacity: 0.7 }}>{status}</div>

      {requests.map((r) => (
        <div
          key={r.id}
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 14,
            background: "white",
          }}
        >
          <div style={{ fontWeight: 800 }}>{r.requester_name || "Unnamed"}</div>

          <div>Service: {r.requested_service || "—"}</div>
          <div>Party: {r.guest_count || 0}</div>
          <div>Site: {r.site_number || "—"}</div>
          <div>Phone: {r.requester_phone || "—"}</div>
          <div>Email: {r.requester_email || "—"}</div>
          <div>
            Status: <strong>{r.request_status || "new"}</strong>
          </div>

          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}
          >
            {r.requester_phone ? (
              <>
                <a
                  href={`tel:${r.requester_phone.replace(/\D+/g, "")}`}
                  style={vendorActionButtonStyle}
                >
                  Call Member
                </a>

                <a
                  href={`sms:${r.requester_phone.replace(/\D+/g, "")}`}
                  style={vendorActionButtonStyle}
                >
                  Text Member
                </a>
              </>
            ) : null}

            {r.requester_email ? (
              <a
                href={`mailto:${r.requester_email}`}
                style={vendorActionButtonStyle}
              >
                Email Member
              </a>
            ) : null}
          </div>

          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}
          >
            <button
              type="button"
              onClick={() => void updateRequestStatus(r.id, "completed")}
              disabled={updatingId === r.id || r.request_status === "completed"}
              style={vendorActionButtonStyle}
            >
              {updatingId === r.id
                ? "Updating..."
                : r.request_status === "completed"
                  ? "Completed"
                  : "Mark Completed"}
            </button>

            <button
              type="button"
              onClick={() => void updateRequestStatus(r.id, "contacted")}
              disabled={updatingId === r.id || r.request_status === "contacted"}
              style={vendorActionButtonStyle}
            >
              {r.request_status === "contacted"
                ? "Contacted"
                : "Mark Contacted"}
            </button>
          </div>

          {r.request_notes ? (
            <div style={{ marginTop: 6 }}>
              <strong>Notes:</strong> {r.request_notes}
            </div>
          ) : null}
        </div>
      ))}

      {requests.length === 0 && status !== "Loading..." ? (
        <div>No requests found.</div>
      ) : null}
    </div>
  );
}

export default function VendorRequestsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 20 }}>Loading requests...</div>}>
      <VendorRequestsInner />
    </Suspense>
  );
}

const vendorActionButtonStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
};
