export default function SlideshowViewPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "black",
        color: "white",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          height: 70,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          borderBottom: "1px solid #222",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            background: "#444",
            marginRight: 12,
          }}
        />

        <div style={{ fontSize: 24, fontWeight: 700 }}>AMANA 2026</div>
      </header>

      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            border: "1px dashed #333",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 42,
            opacity: 0.4,
          }}
        >
          PHOTO AREA
        </div>
      </main>

      <footer
        style={{
          minHeight: 90,
          padding: "16px 32px",
          textAlign: "center",
          fontSize: 32,
          fontWeight: 500,
          borderTop: "1px solid #222",
          flexShrink: 0,
        }}
      >
        Optional Caption Area
      </footer>
    </div>
  );
}
