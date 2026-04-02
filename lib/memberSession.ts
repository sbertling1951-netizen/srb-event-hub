export type MemberSession = {
  event_id: string;
  event_name: string | null;
  event_code: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  lat?: number | null;
  lng?: number | null;
  login_at: string;
  expires_at: string | null;
};

const MEMBER_SESSION_KEY = "fcoc-member-session";
const MEMBER_EVENT_CONTEXT_KEY = "fcoc-member-event-context";

export function saveMemberSession(session: MemberSession) {
  if (typeof window === "undefined") return;

  localStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify(session));

  localStorage.setItem(
    MEMBER_EVENT_CONTEXT_KEY,
    JSON.stringify({
      id: session.event_id,
      name: session.event_name,
      eventName: session.event_name,
      venue_name: session.venue_name || null,
      location: session.location || null,
      start_date: session.start_date || null,
      end_date: session.end_date || null,
      event_code: session.event_code || null,
      lat: session.lat || null,
      lng: session.lng || null,
    }),
  );

  localStorage.setItem("fcoc-member-event-changed", String(Date.now()));
  localStorage.setItem("fcoc-user-role", "member");
}

export function getMemberSession(): MemberSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(MEMBER_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MemberSession;
  } catch (err) {
    console.error("Could not read member session:", err);
    return null;
  }
}

export function isMemberSessionExpired(session: MemberSession | null): boolean {
  if (!session) return true;
  if (!session.expires_at) return false;

  const expiresAt = new Date(session.expires_at).getTime();
  if (Number.isNaN(expiresAt)) return false;

  return Date.now() >= expiresAt;
}

export function clearMemberSession() {
  if (typeof window === "undefined") return;

  localStorage.removeItem(MEMBER_SESSION_KEY);
  localStorage.removeItem(MEMBER_EVENT_CONTEXT_KEY);
  localStorage.removeItem("fcoc-member-event-changed");
  localStorage.removeItem("fcoc-user-role");
}
