"use client";

type ActiveEvent = {
  id: string;
  name: string;
};

type AgendaTemplate = {
  id: string;
  name: string;
  description: string | null;
  status: string;
};

type Props = {
  isMobile: boolean;
  activeEvent: ActiveEvent | null;
  itemCount: number;
  templates: AgendaTemplate[];
  selectedTemplateId: string;
  assignedTemplateName: string;
  newTemplateName: string;
  newTemplateDescription: string;
  savingTemplate: boolean;
  setSelectedTemplateId: (value: string) => void;
  setNewTemplateName: (value: string) => void;
  setNewTemplateDescription: (value: string) => void;
  onSaveTemplate: () => Promise<void>;
  onAssignTemplate: () => Promise<void>;
  onCopyTemplate: () => Promise<void>;
  onReplaceFromTemplate: () => Promise<void>;
};

export default function AgendaTemplatePanel(props: Props) {
  const {
    isMobile,
    activeEvent,
    itemCount,
    templates,
    selectedTemplateId,
    assignedTemplateName,
    newTemplateName,
    newTemplateDescription,
    savingTemplate,
    setSelectedTemplateId,
    setNewTemplateName,
    setNewTemplateDescription,
    onSaveTemplate,
    onAssignTemplate,
    onCopyTemplate,
    onReplaceFromTemplate,
  } = props;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        gap: 20,
        marginBottom: 20,
        alignItems: "start",
      }}
    >
      <div style={panelStyle}>
        <div>
          <div style={titleStyle}>Save Agenda Template</div>
          <div style={helpStyle}>
            Save this event schedule as a reusable template.
          </div>
        </div>

        <input
          value={newTemplateName}
          onChange={(e) => setNewTemplateName(e.target.value)}
          placeholder="Template name, e.g. Spring Rally Standard Agenda"
          style={inputStyle}
          disabled={savingTemplate}
        />

        <textarea
          value={newTemplateDescription}
          onChange={(e) => setNewTemplateDescription(e.target.value)}
          placeholder="Optional template notes or description"
          style={textareaStyle}
          disabled={savingTemplate}
        />

        <button
          type="button"
          onClick={() => void onSaveTemplate()}
          disabled={savingTemplate || !activeEvent || itemCount === 0}
          style={{ width: "fit-content" }}
        >
          {savingTemplate
            ? "Saving Template..."
            : "Save Current Agenda as Template"}
        </button>
      </div>

      <div style={panelStyle}>
        <div>
          <div style={titleStyle}>Use Saved Template</div>
          <div style={helpStyle}>
            Assign or copy an existing reusable agenda template.
          </div>
        </div>

        <select
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          style={inputStyle}
        >
          <option value="">Select template</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void onAssignTemplate()}>
            Assign Template to Event
          </button>

          <button type="button" onClick={() => void onCopyTemplate()}>
            Copy Template Items to Event
          </button>

          <button type="button" onClick={() => void onReplaceFromTemplate()}>
            Replace Event Agenda From Template
          </button>
        </div>

        <div style={{ fontSize: 12, color: "#666" }}>
          Current assigned template: {assignedTemplateName}
        </div>
      </div>
    </div>
  );
}

const panelStyle = {
  border: "1px solid #ddd",
  borderRadius: 10,
  background: "white",
  padding: 16,
  display: "grid",
  gap: 14,
  height: "100%",
};

const titleStyle = {
  fontWeight: 800,
  fontSize: 18,
};

const helpStyle = {
  fontSize: 13,
  color: "#666",
  marginTop: 4,
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: 8,
};

const textareaStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "7px 8px",
  minHeight: 48,
};
