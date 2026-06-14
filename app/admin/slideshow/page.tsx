"use client";

import Link from "next/link";

export default function AdminSlideshowPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#111",
        color: "white",
        padding: 24,
      }}
    >
      <h1>Slideshow Presenter</h1>
      <p>V1 Presenter Console</p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginTop: 24,
        }}
      >
        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            minHeight: 300,
          }}
        >
          <h3>Current Photo</h3>
        </div>

        <div
          style={{
            border: "1px solid #444",
            borderRadius: 8,
            padding: 16,
            minHeight: 300,
          }}
        >
          <h3>Next Photo</h3>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <button>Previous</button> <button>Pause</button> <button>Next</button>
      </div>

      <div style={{ marginTop: 24 }}>
        <Link
          href="/slideshow/view"
          target="_blank"
          style={{ color: "#60a5fa" }}
        >
          Open Audience Screen
        </Link>
      </div>
    </div>
  );
}
