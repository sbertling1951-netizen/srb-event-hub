import { type CSSProperties } from "react";

type Props = {
  presets: Array<{
    id: string;
    name: string;
    reportType: string;
    sortType: string;
    participantTypeFilter: string;
    dataStatusFilter: string;
  }>;
  onApply: (preset: any) => void;
  onDelete: (presetId: string) => void;
};
const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#ffffff",
  color: "#111827",
  WebkitTextFillColor: "#111827",
  fontWeight: 700,
  lineHeight: 1.2,
  cursor: "pointer",
};

export default function SavedPresetsCard(props: Props) {
  const { presets, onApply, onDelete } = props;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Saved Report Presets</h2>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          Save your current report type, sort, and filters for quick reuse on
          this device.
        </div>
      </div>

      {presets.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No saved report presets yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {presets.map((preset) => (
            <div
              key={preset.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 12,
                padding: 12,
                background: "white",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>{preset.name}</div>
                <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                  {preset.reportType.replace(/_/g, " ")} • {preset.sortType} •{" "}
                  {preset.participantTypeFilter} • {preset.dataStatusFilter}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => onApply(preset)}
                  style={secondaryButtonStyle}
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(preset.id)}
                  style={secondaryButtonStyle}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
