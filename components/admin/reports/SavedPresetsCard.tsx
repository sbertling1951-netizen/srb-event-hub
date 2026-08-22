import { AppButton } from "@/components/ui/AppButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";

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

export default function SavedPresetsCard(props: Props) {
  const { presets, onApply, onDelete } = props;

  return (
    <PageSection
      variant="card"
      title="Saved Report Presets"
      titleStyle={{ marginBottom: "var(--space-1)" }}
    >
      <p className="app-subtle-text" style={{ marginTop: 0, marginBottom: "var(--space-4)" }}>
        Save your current report type, sort, and filters for quick reuse on this device.
      </p>

      {presets.length === 0 ? (
        <EmptyState message="No saved report presets yet." />
      ) : (
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {presets.map((preset) => (
            <div
              key={preset.id}
              style={{
                border: "var(--border-width-default) solid var(--color-border-default)",
                borderRadius: "var(--radius-medium)",
                padding: "var(--space-3)",
                background: "var(--color-bg-panel)",
                display: "flex",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div>
                <div className="data-table-cell-primary">{preset.name}</div>
                <div className="data-table-cell-meta" style={{ marginTop: "var(--space-1)" }}>
                  {preset.reportType.replace(/_/g, " ")} • {preset.sortType} •{" "}
                  {preset.participantTypeFilter} • {preset.dataStatusFilter}
                </div>
              </div>

              <RowActions>
                <AppButton onClick={() => onApply(preset)}>Apply</AppButton>
                <AppButton variant="danger" onClick={() => onDelete(preset.id)}>
                  Delete
                </AppButton>
              </RowActions>
            </div>
          ))}
        </div>
      )}
    </PageSection>
  );
}
