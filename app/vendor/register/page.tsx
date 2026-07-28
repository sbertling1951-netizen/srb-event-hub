"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { supabase } from "@/lib/supabase";

export default function VendorRegisterPage() {
  const router = useRouter();

  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [preferredContactMethod, setPreferredContactMethod] = useState<"email" | "phone" | "text">("email");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Create your vendor organization and owner account.");

  async function submitRegistration() {
    if (!businessName.trim()) {
      setStatus("Business name is required.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Checking sign-in session...");

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const accessToken = session?.access_token;
      if (!accessToken) {
        setStatus("Sign in first, then complete registration.");
        return;
      }

      setStatus("Creating your vendor organization...");

      const response = await fetch("/api/vendor/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          accessToken,
          businessName,
          contactName,
          email,
          phone,
          website,
          businessDescription,
          preferredContactMethod,
        }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not complete vendor registration.");
      }

      setStatus("Registration complete. Opening vendor workspace...");

      const sessionResponse = await fetch("/api/vendor/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ accessToken }),
      });

      const sessionPayload = (await sessionResponse.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!sessionResponse.ok || !sessionPayload.ok) {
        throw new Error(sessionPayload.error || "Could not establish vendor session.");
      }

      router.replace("/vendor/workspace");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not complete vendor registration.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 760, margin: "0 auto", display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: 18, display: "grid", gap: 10 }}>
        <h1 style={{ marginTop: 0, marginBottom: 0 }}>Vendor Registration</h1>
        <div style={{ color: "#555", fontSize: 14 }}>
          Create a fresh vendor organization with person-specific access. This account becomes the initial vendor administrator.
        </div>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Business Name</div>
          <input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Example Vendor LLC"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Contact Name</div>
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            placeholder="Owner or primary contact"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Email</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Phone</div>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Website</div>
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.com"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Preferred Contact Method</div>
          <select
            value={preferredContactMethod}
            onChange={(e) => setPreferredContactMethod(e.target.value as "email" | "phone" | "text")}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="email">Email</option>
            <option value="phone">Phone</option>
            <option value="text">Text</option>
          </select>
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Business Description</div>
          <textarea
            value={businessDescription}
            onChange={(e) => setBusinessDescription(e.target.value)}
            placeholder="Describe your services"
            style={{ width: "100%", minHeight: 96, padding: 10 }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void submitRegistration()}
            disabled={busy}
            className="app-button app-button-primary"
          >
            {busy ? "Registering..." : "Create Vendor Workspace"}
          </button>

          <Link href="/vendor/login" className="app-button app-button-muted">
            Vendor Login
          </Link>
        </div>

        <div style={{ fontSize: 14, color: "#555" }}>{status}</div>
      </div>
    </div>
  );
}
