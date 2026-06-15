"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AdminSlideshowPage() {
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    localStorage.setItem(
      "epic_slideshow_current",
      String(currentSlide),
    );
  }, [currentSlide]);

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
        <button
          onClick={() => setCurrentSlide((s) => Math.max(0, s - 1))}
        >
          Previous
        </button>{" "}
        <button>Pause</button>{" "}
        <button onClick={() => setCurrentSlide((s) => s + 1)}>
          Next
        </button>
      </div>

      <div style={{ marginTop: 12, opacity: 0.8 }}>
        Current Slide: {currentSlide}
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
