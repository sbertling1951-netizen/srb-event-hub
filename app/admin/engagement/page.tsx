"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function EngagementPage() {
  const [stats, setStats] = useState({
    registered: 0,
    loggedIn: 0,
    started: 0,
    submitted: 0,
  });

  useEffect(() => {
    async function loadStats() {
      const { count: registered } = await supabase
        .from("attendees")
        .select("*", { count: "exact", head: true })
        .eq("registration_status", "active");

      const { data: loginRows } = await supabase
        .from("engagement_activity")
        .select("attendee_id")
        .eq("activity_type", "login");

      const loggedIn = new Set(
        (loginRows ?? []).map((row) => row.attendee_id)
      ).size;

      setStats((prev) => ({
        ...prev,
        registered: registered ?? 0,
        loggedIn,
      }));
    }

    loadStats();
  }, []);

  const cards = [
    { title: "Registered Members", value: stats.registered },
    { title: "Logged Into App", value: stats.loggedIn },
    { title: "Evaluations Started", value: stats.started },
    { title: "Evaluations Submitted", value: stats.submitted },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 6 }}>Member Engagement</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>
        Understand how members are using the Event Hub during your event.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {cards.map((card) => (
          <div
            key={card.title}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 16,
              background: "#fff",
            }}
          >
            <div style={{ fontSize: 14, color: "#666" }}>{card.title}</div>
            <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
          <h2>Feature Usage</h2>
          <p>Usage analytics will appear here.</p>
        </section>

        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
          <h2>Recent Activity</h2>
          <p>Recent member activity will appear here.</p>
        </section>

        <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
          <h2>Evaluation Progress</h2>
          <p>Evaluation completion metrics will appear here.</p>
        </section>
      </div>
    </div>
  );
}
