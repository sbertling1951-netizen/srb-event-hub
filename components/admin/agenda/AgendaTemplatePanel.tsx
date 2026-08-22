"use client";

import { AppButton } from "@/components/ui/AppButton";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { PageSection } from "@/components/ui/PageSection";

type ActiveEvent = {
  id: string;
  name: string;
};

// Matches the shape returned by the governed list_available_agenda_templates
// RPC -- a "template" the admin can select is always a specific published
// revision of a Platform- or Tenant-owned root, never a draft.
type AgendaTemplate = {
  source_scope: "platform" | "tenant";
  template_root_id: string;
  revision_id: string;
  revision_number: number;
  title: string;
  description: string | null;
  revision_status: string;
  tenant_id: string | null;
};

type Props = {
  activeEvent: ActiveEvent | null;
  itemCount: number;
  templates: AgendaTemplate[];
  selectedTemplateId: string;
  newTemplateName: string;
  newTemplateDescription: string;
  savingTemplate: boolean;
  applyingTemplate: boolean;
  replacingFromTemplate: boolean;
  setSelectedTemplateId: (value: string) => void;
  setNewTemplateName: (value: string) => void;
  setNewTemplateDescription: (value: string) => void;
  onSaveTemplate: () => Promise<void>;
  onApplyTemplate: () => Promise<void>;
  onReplaceFromTemplate: () => Promise<void>;
};

// Stacked, not side-by-side: this panel now lives inside the Agenda page's
// narrow "Catalog & Templates" column (see app/admin/agenda/page.tsx), so a
// two-up layout would leave each half too cramped to use -- the outer page
// grid is what now provides the wide/narrow responsive split.
export default function AgendaTemplatePanel(props: Props) {
  const {
    activeEvent,
    itemCount,
    templates,
    selectedTemplateId,
    newTemplateName,
    newTemplateDescription,
    savingTemplate,
    applyingTemplate,
    replacingFromTemplate,
    setSelectedTemplateId,
    setNewTemplateName,
    setNewTemplateDescription,
    onSaveTemplate,
    onApplyTemplate,
    onReplaceFromTemplate,
  } = props;

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <PageSection title="Save Agenda Template" titleStyle={{ margin: 0 }}>
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <p className="app-subtle-text" style={{ margin: 0 }}>
            Save this event schedule as a reusable template.
          </p>

          <Field label="Template Name">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="e.g. Spring Rally Standard Agenda"
                disabled={savingTemplate}
              />
            )}
          </Field>

          <Field label="Description" help="Optional template notes or description.">
            {(controlProps) => (
              <Textarea
                {...controlProps}
                value={newTemplateDescription}
                onChange={(e) => setNewTemplateDescription(e.target.value)}
                placeholder="Optional template notes or description"
                rows={3}
                disabled={savingTemplate}
              />
            )}
          </Field>

          <FormActions>
            <AppButton
              variant="primary"
              onClick={() => void onSaveTemplate()}
              disabled={savingTemplate || !activeEvent || itemCount === 0}
            >
              {savingTemplate ? "Saving Template..." : "Save Current Agenda as Template"}
            </AppButton>
          </FormActions>
        </div>
      </PageSection>

      <PageSection title="Use Saved Template" titleStyle={{ margin: 0 }}>
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <p className="app-subtle-text" style={{ margin: 0 }}>
            Apply an existing reusable agenda template to this event, or
            replace this event&apos;s agenda with one.
          </p>

          <Field label="Template">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
              >
                <option value="">Select template</option>
                {templates.map((template) => (
                  <option key={template.revision_id} value={template.revision_id}>
                    {template.source_scope === "platform" ? "Platform: " : "Tenant: "}
                    {template.title} (rev {template.revision_number})
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <FormActions>
            <AppButton
              onClick={() => void onApplyTemplate()}
              disabled={applyingTemplate || replacingFromTemplate}
            >
              {applyingTemplate ? "Applying..." : "Apply Template to Event"}
            </AppButton>

            <AppButton
              variant="danger"
              onClick={() => void onReplaceFromTemplate()}
              disabled={applyingTemplate || replacingFromTemplate}
            >
              {replacingFromTemplate ? "Replacing..." : "Replace Event Agenda From Template"}
            </AppButton>
          </FormActions>
        </div>
      </PageSection>
    </div>
  );
}
