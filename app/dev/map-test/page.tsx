import InteractiveMapViewport from "@/components/map/InteractiveMapViewport";

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
      <InteractiveMapViewport
        imageUrl="/test-map.jpg"
        width={1800}
        height={1200}
      >
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
      </InteractiveMapViewport>
    </div>
  );
}
