/* eslint-disable react-hooks/exhaustive-deps */
"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import {
  getCurrentAdminEvent,
  useAdminWorkingEventScope,
} from "@/lib/adminWorkspaceContext";
import { fetchEventOperationalSummary } from "@/lib/eventOperationalSummary";

import { supabase } from "@/lib/supabase";

const ACTIVITY_LIMIT_STORAGE_KEY = "engagementActivityLimit";
const ACTIVITY_LIMIT_OPTIONS = ["10", "25", "50", "100", "250", "500", "all"] as const;

type ActivityLimitOption = (typeof ACTIVITY_LIMIT_OPTIONS)[number];

const ACTIVITY_LABELS: Record<string, string> = {
  login: "Login",
  view_attendee_locator: "Attendee Locator",
  agenda_view: "Agenda",
  announcement_view: "Announcements",
  nearby_view: "Nearby",
  photos_view: "Photos",
  coach_map_view: "Coach Map",
  checkin_view: "Check-In",
  participants_view: "Participants",
  evaluation_started: "Evaluation Started",
  evaluation_submitted: "Evaluation Submitted",
};

const EMPTY_FEATURE_STATS = {
  attendeeLocator: 0,
  agenda: 0,
  announcements: 0,
  nearby: 0,
  photos: 0,
  coachMap: 0,
  checkIn: 0,
  participants: 0,
};

function formatActivityLabel(activityType: string): string {
  if (ACTIVITY_LABELS[activityType]) {
    return ACTIVITY_LABELS[activityType];
  }

  return activityType
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function EngagementPageInner() {
  const [stats, setStats] = useState({
    loggedIn: 0,
    started: 0,
    submitted: 0,
  });

  // Canonical Event-wide active registration count, per
  // docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md's Canonical
  // Event Operational Summary Read Contract. Consumed verbatim from
  // fetchEventOperationalSummary -- never recomputed locally.
  const [activeRegistrations, setActiveRegistrations] = useState<
    number | null
  >(null);
  const [activeRegistrationsError, setActiveRegistrationsError] = useState<
    string | null
  >(null);

  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [activityLimit, setActivityLimit] = useState<ActivityLimitOption>("100");

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

  const loadStatsRef = useRef<() => void>(() => {});

  const { captureGeneration, isCurrent } = useAdminWorkingEventScope(() => {
    // Working Event changed (this tab or another): drop Event A's numbers
    // immediately so they never sit under Event B's header, then reload.
    setStats({ loggedIn: 0, started: 0, submitted: 0 });
    setActiveRegistrations(null);
    setActiveRegistrationsError(null);
    setRecentActivity([]);
    setFeatureStats(EMPTY_FEATURE_STATS);
    loadStatsRef.current();
  });

  const loadStats = useCallback(async () => {
    const generation = captureGeneration();
    const currentEvent = getCurrentAdminEvent();
    if (!currentEvent?.id) {
      setStats({ loggedIn: 0, started: 0, submitted: 0 });
      setActiveRegistrations(null);
      setActiveRegistrationsError(null);
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

    const summaryResult = await fetchEventOperationalSummary(currentEvent.id);

    // Reject a superseded load: the working Event changed while this was in
    // flight and a newer loadStats() is already populating Event B.
    if (!isCurrent(generation)) {
      return;
    }

    if (summaryResult.ok) {
      setActiveRegistrations(summaryResult.summary.activeRegistrations);
      setActiveRegistrationsError(null);
    } else {
      // Fail visibly: never substitute a locally recomputed registration
      // count when the canonical summary call fails or is denied.
      setActiveRegistrations(null);
      setActiveRegistrationsError(
        summaryResult.reason === "authorization_denied"
          ? "You do not have access to the operational summary for this event."
          : summaryResult.message,
      );
    }

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

    let recentActivityQuery = supabase
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
      .order("activity_time", { ascending: false });

    if (activityLimit !== "all") {
      recentActivityQuery = recentActivityQuery.limit(Number(activityLimit));
    }

    const { data: recentActivity } = await recentActivityQuery;

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
        case "agenda_view":
          featureCounts.agenda++;
          break;
        case "announcement_view":
          featureCounts.announcements++;
          break;
        case "nearby_view":
          featureCounts.nearby++;
          break;
        case "photos_view":
          featureCounts.photos++;
          break;
        case "coach_map_view":
          featureCounts.coachMap++;
          break;
        case "checkin_view":
          featureCounts.checkIn++;
          break;
        case "participants_view":
          featureCounts.participants++;
          break;
      }
    });

    if (!isCurrent(generation)) {
      return;
    }

    setStats({
      loggedIn,
      started,
      submitted,
    });

    setRecentActivity(recentActivity ?? []);
    setFeatureStats(featureCounts);
  }, [activityLimit, captureGeneration, isCurrent]);

  useEffect(() => {
    try {
      const savedLimit = localStorage.getItem(ACTIVITY_LIMIT_STORAGE_KEY);
      if (
        savedLimit &&
        ACTIVITY_LIMIT_OPTIONS.includes(savedLimit as ActivityLimitOption)
      ) {
        setActivityLimit(savedLimit as ActivityLimitOption);
      }
    } catch {
      // Ignore localStorage failures so the page still loads.
    }
  }, []);

  useEffect(() => {
    loadStatsRef.current = () => void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  function handleActivityLimitChange(
    event: React.ChangeEvent<HTMLSelectElement>
  ) {
    const nextLimit = event.target.value as ActivityLimitOption;
    setActivityLimit(nextLimit);

    try {
      localStorage.setItem(ACTIVITY_LIMIT_STORAGE_KEY, nextLimit);
    } catch {
      // Ignore localStorage failures so the selector still works.
    }
  }

  const cards: { title: string; value: number | string }[] = [
    {
      title: "Active Registrations",
      value:
        activeRegistrations !== null
          ? activeRegistrations
          : activeRegistrationsError || "Unavailable",
    },
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
    { title: "Participant Views", value: featureStats.participants },
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
            <div
              style={
                typeof card.value === "number"
                  ? { fontSize: 32, fontWeight: 700, marginTop: 8 }
                  : {
                      fontSize: 14,
                      fontWeight: 600,
                      marginTop: 8,
                      color: "#b91c1c",
                    }
              }
            >
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <h2 style={{ margin: 0 }}>Recent Activity</h2>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 14,
                color: "#666",
              }}
            >
              <span>Show:</span>
              <select
                value={activityLimit}
                onChange={handleActivityLimitChange}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: "6px 10px",
                  background: "#fff",
                  color: "#111",
                  fontSize: 14,
                }}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="250">250</option>
                <option value="500">500</option>
                <option value="all">All</option>
              </select>
            </label>
          </div>
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
                        {formatActivityLabel(item.activity_type)}
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

export default function EngagementPage() {
  return (
    // Auth-only gate (no requiredPermission): this route has no governed
    // permission key of its own. Its nav-visibility gate
    // (components/shell/navigation/adminNav.ts) is admin?.privilege_group
    // === "super_admin" checked directly, deliberately not translated
    // through hasPermission()/requiredPermission when that nav was
    // migrated -- resolving that bypass was explicitly deferred to a
    // future ADR-011 Workspace Resolver migration, not decided here.
    // Asserting a requiredPermission (e.g. can_manage_admins) would invent
    // authority semantics no governed source establishes for this page,
    // and could silently drift from the nav gate if that permission key's
    // grant is ever edited independently via /admin/permissions. This
    // mirrors the same bare-AdminRouteGuard pattern already used by
    // Evaluations, Photo Library, Agenda, Attendees, and Map Admin: it
    // closes the "reachable by any authenticated user" gap without
    // asserting a privilege-group-specific rule the guard cannot express.
    <AdminRouteGuard>
      <AdminShellAdapter pageTitle="Attendee Engagement">
        <EngagementPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
