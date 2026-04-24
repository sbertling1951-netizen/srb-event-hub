"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { supabase } from "@/lib/supabase";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const router = useRouter();

  async function handleLogin() {
    try {
      setStatus("Signing in...");

      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail) {
        setStatus("Enter your email.");
        return;
      }

      if (!password) {
        setStatus("Enter your password.");
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {throw error;}

      if (!data.session) {
        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError) {throw sessionError;}
        if (!sessionData.session) {
          throw new Error(
            "Login succeeded but no session was available yet. Please try again.",
          );
        }
      }

      localStorage.setItem("fcoc-user-mode", "admin");
      localStorage.setItem("fcoc-admin-email", normalizedEmail);
      localStorage.setItem("fcoc-user-mode-changed", String(Date.now()));

      // clear old member session
      localStorage.removeItem("fcoc-member-attendee-id");
      localStorage.removeItem("fcoc-member-email");
      localStorage.removeItem("fcoc-member-entry-id");
      localStorage.removeItem("fcoc-member-has-arrived");
      localStorage.removeItem("fcoc-member-event-context");
      localStorage.removeItem("fcoc-member-event-changed");

      setStatus("Login successful. Opening dashboard...");

      setTimeout(() => {
        router.replace("/admin/dashboard");
        router.refresh();
      }, 150);
    } catch (err: any) {
      console.error("Admin login error:", err);
      setStatus(err?.message || "Login failed.");
    }
  }

  async function handleForgotPassword() {
    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail) {
        setStatus("Enter your email first.");
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: window.location.origin,
        },
      );

      if (error) {throw error;}

      setStatus("Password reset email sent.");
    } catch (err: any) {
      console.error("Forgot password error:", err);
      setStatus(err?.message || "Could not send reset email.");
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Admin Login</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleLogin();
        }}
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Username / Email
          </div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Password</div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={{ width: "100%", padding: 10 }}
          />
        </label>

        <button
          type="submit"
          disabled={status === "Signing in..."}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Login
        </button>

        <button
          type="button"
          onClick={handleForgotPassword}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#f8f9fb",
            cursor: "pointer",
          }}
        >
          Forgot Password
        </button>

        <div style={{ fontSize: 13, color: "#666" }}>{status}</div>
      </form>
    </div>
  );
}
