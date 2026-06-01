"use client";

import MapCanvas from "@/components/map/MapCanvas";

export default function MapTestPage() {
  return (
    <div
      style={{
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
        background: "#111827",
      }}
    >
      <MapCanvas width={4000} height={2500}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(45deg, #1e293b 25%, #334155 25%, #334155 50%, #1e293b 50%, #1e293b 75%, #334155 75%, #334155 100%)",
            backgroundSize: "120px 120px",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 400,
            top: 300,
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "#ef4444",
            border: "4px solid white",
            transform: "translate(-50%, -50%)",
          }}
        />

        <div
          style={{
            position: "absolute",
            left: 900,
            top: 700,
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "#22c55e",
            border: "4px solid white",
            transform: "translate(-50%, -50%)",
          }}
        />
      </MapCanvas>
    </div>
  );
}
