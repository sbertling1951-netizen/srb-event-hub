"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import LoginActionButton from "@/components/auth/LoginActionButton";
import { clearCurrentAdminEvent } from "@/lib/adminWorkspaceContext";
import { STORAGE_KEYS } from "@/lib/storageKeys";
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
      const normalizedPassword = password.trim();

      if (!normalizedEmail) {
        setStatus("Enter your email.");
        return;
      }

      if (!normalizedPassword) {
        setStatus("Enter your password.");
        return;
      }

      console.log("LOGIN START");

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword,
      });

      console.log("LOGIN RETURNED", {
        hasData: !!data,
        hasSession: !!data?.session,
        error: error?.message,
      });

      if (error) {
        throw error;
      }

      console.log("AFTER ERROR CHECK");

      if (!data.session) {
        console.log("NO SESSION - CHECKING GETSESSION");

        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        console.log("GETSESSION RETURNED", {
          hasSession: !!sessionData?.session,
          error: sessionError?.message,
        });

        if (sessionError) {
          throw sessionError;
        }

        if (!sessionData.session) {
          throw new Error(
            "Login succeeded but no session was available yet. Please try again.",
          );
        }
      }

      console.log("LOGIN COMPLETE");

      localStorage.setItem(STORAGE_KEYS.userMode, "admin");
      localStorage.setItem(STORAGE_KEYS.adminEmail, normalizedEmail);
      localStorage.setItem(STORAGE_KEYS.userModeChanged, String(Date.now()));

      clearCurrentAdminEvent();

      // clear old member session
      localStorage.removeItem(STORAGE_KEYS.memberAttendeeId);
      localStorage.removeItem(STORAGE_KEYS.memberEntryId);
      localStorage.removeItem(STORAGE_KEYS.memberHasArrived);
      localStorage.removeItem(STORAGE_KEYS.memberEventContext);
      localStorage.removeItem(STORAGE_KEYS.memberEventChanged);

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

      if (error) {
        throw error;
      }

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

        <LoginActionButton
          variant="primary"
          type="submit"
          disabled={status === "Signing in..."}
        >
          Login
        </LoginActionButton>

        <div
          role="group"
          aria-label="Other sign-in options"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 8,
          }}
        >
          <LoginActionButton variant="recovery" onClick={handleForgotPassword}>
            Forget Password
          </LoginActionButton>

          <LoginActionButton variant="back" href="/login">
            Choose Login Type
          </LoginActionButton>
        </div>

        <div style={{ fontSize: 13, color: "#666" }}>{status}</div>
      </form>

    </div>
  );
}
