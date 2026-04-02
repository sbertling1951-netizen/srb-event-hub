"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  async function handleLogin() {
    try {
      setStatus("Signing in...");

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      localStorage.setItem("fcoc-user-role", "admin");
      window.location.href = "/admin/dashboard";
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Login failed.");
    }
  }

  async function handleForgotPassword() {
    try {
      if (!email.trim()) {
        setStatus("Enter your email first.");
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: window.location.origin,
        },
      );

      if (error) throw error;

      setStatus("Password reset email sent.");
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Could not send reset email.");
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Admin Login</h1>

      <div
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
          type="button"
          onClick={handleLogin}
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
      </div>
    </div>
  );
}
