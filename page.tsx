import Link from "next/link";

export default function HomePage() {
  return (
    <div style={{ padding: 30 }}>
      <h1 style={{ marginTop: 0, color: "var(--fcoc-red)" }}>FCOC Event Hub</h1>

      <p style={{ fontSize: 18, marginBottom: 24 }}>
        Welcome to the Freightliner Chassis Owners Club event app.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
        }}
      >
        <Link
          href="/attendees"
          style={{
            display: "block",
            padding: 20,
            border: "1px solid var(--fcoc-border)",
            borderRadius: 10,
            background: "white",
            textDecoration: "none",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Attendee Locator</h3>
          <p>
            Find members by name, site number, membership number, or coach info.
          </p>
        </Link>

        <Link
          href="/agenda"
          style={{
            display: "block",
            padding: 20,
            border: "1px solid var(--fcoc-border)",
            borderRadius: 10,
            background: "white",
            textDecoration: "none",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Agenda</h3>
          <p>
            View the event schedule, activity times, and key rally information.
          </p>
        </Link>

        <Link
          href="/nearby"
          style={{
            display: "block",
            padding: 20,
            border: "1px solid var(--fcoc-border)",
            borderRadius: 10,
            background: "white",
            textDecoration: "none",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Nearby Locations</h3>
          <p>
            See nearby fuel, groceries, urgent care, pharmacy, and other
            services.
          </p>
        </Link>

        <Link
          href="/map"
          style={{
            display: "block",
            padding: 20,
            border: "1px solid var(--fcoc-border)",
            borderRadius: 10,
            background: "white",
            textDecoration: "none",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Coach Map</h3>
          <p>View the campground map and locate coaches by site number.</p>
        </Link>

        <Link
          href="/announcements"
          style={{
            display: "block",
            padding: 20,
            border: "1px solid var(--fcoc-border)",
            borderRadius: 10,
            background: "white",
            textDecoration: "none",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Announcements</h3>
          <p>Read event updates, schedule changes, and important notices.</p>
        </Link>

        <Link
          href="/admin/imports"
          style={{
            display: "block",
            padding: 20,
            border: "1px solid var(--fcoc-border)",
            borderRadius: 10,
            background: "white",
            textDecoration: "none",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Admin Imports</h3>
          <p>
            Upload registration CSV files and load attendee data into the app.
          </p>
        </Link>

        <Link
          href="/admin/parking"
          style={{
            display: "block",
            padding: 20,
            border: "1px solid var(--fcoc-border)",
            borderRadius: 10,
            background: "white",
            textDecoration: "none",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Parking Admin</h3>
          <p>
            Place site markers on the campground map and assign attendees to
            sites.
          </p>
        </Link>
      </div>
    </div>
  );
}
