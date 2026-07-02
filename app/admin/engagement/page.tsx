/* eslint-disable react-hooks/exhaustive-deps */
"use client";
import React, { useCallback, useEffect, useState } from "react";

import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";

import { supabase } from "@/lib/supabase";

export default function EngagementPage() {
  const [stats, setStats] = useState({
    registered: 0,
    loggedIn: 0,
    started: 0,
    submitted: 0,
  });

  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  const [featureStats, setFeatureStats] = useState({
    attendeeLocator: 0,
    agenda: 0,
    announcements: 0,
    nearby: 0,
    photos: 0,
    coachMap: 0,
    checkIn: 0,
    participants: 0,
  });

  const loadStats = useCallback(async () => {
    const currentEvent = getCurrentAdminEvent();
    if (!currentEvent?.id) {
      setStats({ registered: 0, loggedIn: 0, started: 0, submitted: 0 });
      setRecentActivity([]);
      setFeatureStats({
        attendeeLocator: 0,
        agenda: 0,
        announcements: 0,
        nearby: 0,
        photos: 0,
        coachMap: 0,
        checkIn: 0,
        participants: 0,
      });
      return;
    }

    const { count: registered, error: registeredError } = await supabase
      .from("attendees")
      .select("*", { count: "exact", head: true })
      .in("registration_status", ["active", "registered"])
      .eq("event_id", currentEvent.id);

    console.log({
      registered,
      registeredError,
    });

    const { data: loginRows } = await supabase
      .from("engagement_activity")
      .select("attendee_id")
      .eq("activity_type", "login")
      .eq("event_id", currentEvent.id);

    const loggedIn = new Set((loginRows ?? []).map((row) => row.attendee_id))
      .size;

    const { data: startedRows } = await supabase
      .from("engagement_activity")
      .select("attendee_id")
      .eq("activity_type", "evaluation_started")
      .eq("event_id", currentEvent.id);

    const started = new Set(
      (startedRows ?? []).map((row) => row.attendee_id)
    ).size;

    const { data: submittedRows } = await supabase
      .from("engagement_activity")
      .select("attendee_id")
      .eq("activity_type", "evaluation_submitted")
      .eq("event_id", currentEvent.id);

    const submitted = new Set(
      (submittedRows ?? []).map((row) => row.attendee_id)
    ).size;

    const { data: recentActivity } = await supabase
      .from("engagement_activity")
      .select(`
        activity_time,
        activity_type,
        attendees:attendee_id (
          pilot_first,
          pilot_last
        )
      `)
      .eq("event_id", currentEvent.id)
      .order("activity_time", { ascending: false })
      .limit(10);

    const { data: featureRows } = await supabase
      .from("engagement_activity")
      .select("activity_type")
      .eq("event_id", currentEvent.id);

    const featureCounts = {
      attendeeLocator: 0,
      agenda: 0,
      announcements: 0,
      nearby: 0,
      photos: 0,
      coachMap: 0,
      checkIn: 0,
      participants: 0,
    };

    (featureRows ?? []).forEach(({ activity_type }) => {
      switch (activity_type) {
        case "view_attendee_locator":
          featureCounts.attendeeLocator++;
          break;
        case "view_agenda":
          featureCounts.agenda++;
          break;
        case "view_announcements":
          featureCounts.announcements++;
          break;
        case "view_nearby":
          featureCounts.nearby++;
          break;
        case "view_photos":
          featureCounts.photos++;
          break;
        case "view_coach_map":
          featureCounts.coachMap++;
          break;
        case "checkin":
          featureCounts.checkIn++;
          break;
        case "view_participants":
          featureCounts.participants++;
          break;
      }
    });

    setStats({
      registered: registered ?? 0,
      loggedIn,
      started,
      submitted,
    });

    setRecentActivity(recentActivity ?? []);
    setFeatureStats(featureCounts);
  }, []);

  useEffect(() => {
    void loadStats();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadStats();
    });

    return unsubscribe;
  }, [loadStats]);

  const cards = [
    { title: "Attendees", value: stats.registered },
    { title: "Logged Into App", value: stats.loggedIn },
    { title: "Evaluations Started", value: stats.started },
    { title: "Evaluations Submitted", value: stats.submitted },
  ];

  const featureCards = [
    { title: "Attendee Locator", value: featureStats.attendeeLocator },
    { title: "Agenda", value: featureStats.agenda },
    { title: "Announcements", value: featureStats.announcements },
    { title: "Nearby", value: featureStats.nearby },
    { title: "Photos", value: featureStats.photos },
    { title: "Coach Map", value: featureStats.coachMap },
    { title: "Check-In", value: featureStats.checkIn },
    { title: "Participants", value: featureStats.participants },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 6 }}>Attendee Engagement</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>
        Monitor attendee activity and engagement throughout your event.
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

      <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
        <h2>Feature Activity</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {featureCards.map((card) => (
            <div
              key={card.title}
              style={{
                border: "1px solid #ddd",
                borderRadius: 10,
                padding: 12,
                background: "#fff",
              }}
            >
              <div style={{ fontSize: 13, color: "#666" }}>{card.title}</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>
                {card.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ display: "grid", gap: 16 }}>
        <section
          style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}
        >
          <h2>Recent Activity</h2>
          {recentActivity.length === 0 ? (
            <p>No recent activity yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {recentActivity.map((item, index) => {
                const attendee = Array.isArray(item.attendees)
                  ? item.attendees[0]
                  : item.attendees;

                return (
                  <div
                    key={index}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      borderBottom: "1px solid #eee",
                      paddingBottom: 6,
                    }}
                  >
                    <div>
                      <strong>
                        {attendee
                          ? `${attendee.pilot_first} ${attendee.pilot_last}`
                          : "Unknown Attendee"}
                      </strong>
                      <div style={{ fontSize: 13, color: "#666" }}>
                        {item.activity_type}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "#666" }}>
                      {new Date(item.activity_time).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section
          style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}
        >
          <h2>Evaluation Progress</h2>
          <p>Evaluation completion metrics will appear here.</p>
        </section>
      </div>
    </div>
  );
}
