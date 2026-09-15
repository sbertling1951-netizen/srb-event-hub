"use client";

import {
  type CSSProperties,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import PageNavigation from "@/components/layout/PageNavigation";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/LoadingState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

type EventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type ValidationSeverity = "error" | "warning";

type ValidationRule = {
  id: string;
  field_name: string;
  rule_type: string;
  rule_value: string | null;
  message: string;
  severity: ValidationSeverity;
  is_active: boolean;
  priority: number;
  applies_to_event_id: string | null;
  created_at?: string | null;
};

type EventOption = {
  id: string;
  name: string | null;
  location: string | null;
  start_date: string | null;
};

type RuleFormState = {
  id: string | null;
  field_name: string;
  rule_type: string;
  rule_value: string;
  message: string;
  severity: ValidationSeverity;
  is_active: boolean;
  priority: string;
  applies_to_event_id: string;
};

function createEmptyForm(): RuleFormState {
  return {
    id: null,
    field_name: "membership_number",
    rule_type: "starts_with",
    rule_value: "",
    message: "",
    severity: "error",
    is_active: true,
    priority: "100",
    applies_to_event_id: "",
  };
}

function formatEventLabel(event: EventOption) {
  const name = event.name || "Untitled Event";
  const location = event.location ? ` • ${event.location}` : "";
  const start = event.start_date ? ` • ${event.start_date}` : "";
  return `${name}${location}${start}`;
}

function normalizeRuleValue(form: RuleFormState) {
  if (form.rule_type === "required") {
    return null;
  }
  const trimmed = form.rule_value.trim();
  return trimmed || null;
}

function fieldLabel(value: string) {
  switch (value) {
    case "membership_number":
      return "Membership Number";
    case "email":
      return "Email";
    case "pilot_first":
      return "Pilot First Name";
    case "pilot_last":
      return "Pilot Last Name";
    case "copilot_first":
      return "Co-Pilot First Name";
    case "copilot_last":
      return "Co-Pilot Last Name";
    case "city":
      return "City";
    case "state":
      return "State";
    default:
      return value.replace(/_/g, " ");
  }
}

function ruleTypeLabel(value: string) {
  switch (value) {
    case "required":
      return "Required";
    case "starts_with":
      return "Starts With";
    case "starts_with_any":
      return "Starts With Any";
    case "contains":
      return "Contains";
    case "min_length":
      return "Minimum Length";
    default:
      return value;
  }
}

function scopeLabel(rule: ValidationRule, events: EventOption[]) {
  if (!rule.applies_to_event_id) {
    return "All Events";
  }
  const found = events.find((event) => event.id === rule.applies_to_event_id);
  return found ? found.name || "Specific Event" : "Specific Event";
}

function AdminValidationRulesPageInner() {
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading validation rules...");
  const [form, setForm] = useState<RuleFormState>(createEmptyForm());
  const [flashMessage, setFlashMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const pageTitle = "Validation Rules";

  const { admin } = useAdmin();
  const { isCompact } = useShellInterfaceCapabilities();

  useEffect(() => {
    if (!admin) {
      return;
    }

    const event = getCurrentAdminEvent();
    setCurrentEvent(event);

    void loadPage(admin!);
    const unsubscribe = subscribeToAdminWorkspace(() => {
      const nextEvent = getCurrentAdminEvent();
      setCurrentEvent(nextEvent);
      void loadPage(admin!);
    });

    return unsubscribe;
  }, [admin]);

  async function loadPage(resolvedAdmin: NonNullable<typeof admin>) {
    try {
      setLoading(true);
      setError(null);
      setStatus("Loading validation rules...");

      const [
        { data: rulesData, error: rulesError },
        { data: eventsData, error: eventsError },
      ] = await Promise.all([
        supabase
          .from("validation_rules")
          .select("*")
          .order("priority", { ascending: true })
          .order("field_name", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("events")
          .select("id, name, location, start_date")
          .order("start_date", { ascending: false }),
      ]);

      if (rulesError) {
        throw rulesError;
      }
      if (eventsError) {
        throw eventsError;
      }

      const accessibleEvents = ((eventsData || []) as EventOption[]).filter(
        (event) => !!event.id && canAccessEvent(resolvedAdmin, event.id),
      );

      setRules((rulesData || []) as ValidationRule[]);
      setEvents(accessibleEvents);
      setStatus(
        `Loaded ${(rulesData || []).length} validation rules across ${accessibleEvents.length} accessible events.`,
      );
    } catch (err: any) {
      console.error("loadPage error:", err);
      setError(err?.message || "Could not load validation rules.");
      setStatus("Could not load validation rules.");
      setRules([]);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  function showFlash(message: string) {
    setFlashMessage(message);
    window.setTimeout(() => {
      setFlashMessage((current) => (current === message ? null : current));
    }, 1800);
  }

  function startNewRule() {
    setForm(createEmptyForm());
  }

  function startEditRule(rule: ValidationRule) {
    setForm({
      id: rule.id,
      field_name: rule.field_name,
      rule_type: rule.rule_type,
      rule_value: rule.rule_value || "",
      message: rule.message,
      severity: rule.severity,
      is_active: rule.is_active,
      priority: String(rule.priority ?? 100),
      applies_to_event_id: rule.applies_to_event_id || "",
    });
  }

  function updateForm<K extends keyof RuleFormState>(
    key: K,
    value: RuleFormState[K],
  ) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "rule_type" && value === "required"
        ? { rule_value: "" }
        : {}),
    }));
  }

  async function handleSaveRule() {
    const priority = Number(form.priority);
    if (!form.field_name.trim()) {
      setError("Field name is required.");
      return;
    }
    if (!form.rule_type.trim()) {
      setError("Rule type is required.");
      return;
    }
    if (form.rule_type !== "required" && !form.rule_value.trim()) {
      setError("Rule value is required for this rule type.");
      return;
    }
    if (!form.message.trim()) {
      setError("Message is required.");
      return;
    }
    if (!Number.isFinite(priority)) {
      setError("Priority must be a valid number.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setStatus(form.id ? "Saving rule..." : "Creating rule...");

      const payload = {
        field_name: form.field_name.trim(),
        rule_type: form.rule_type.trim(),
        rule_value: normalizeRuleValue(form),
        message: form.message.trim(),
        severity: form.severity,
        is_active: form.is_active,
        priority,
        applies_to_event_id: form.applies_to_event_id || null,
      };

      if (form.id) {
        const { error } = await supabase
          .from("validation_rules")
          .update(payload)
          .eq("id", form.id);
        if (error) {
          throw error;
        }
        setStatus("Rule updated.");
        showFlash("Rule updated.");
      } else {
        const { error } = await supabase
          .from("validation_rules")
          .insert(payload);
        if (error) {
          throw error;
        }
        setStatus("Rule created.");
        showFlash("Rule created.");
      }

      setForm(createEmptyForm());
      if (admin) {
        await loadPage(admin);
      }
    } catch (err: any) {
      console.error("handleSaveRule error:", err);
      setError(err?.message || "Could not save rule.");
      setStatus("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRule(ruleId: string) {
    const confirmed = window.confirm(
      "Delete this validation rule? This cannot be undone.",
    );
    if (!confirmed) {
      return;
    }

    try {
      setDeletingRuleId(ruleId);
      setError(null);
      setStatus("Deleting rule...");

      const { error } = await supabase
        .from("validation_rules")
        .delete()
        .eq("id", ruleId);
      if (error) {
        throw error;
      }

      if (form.id === ruleId) {
        setForm(createEmptyForm());
      }
      setStatus("Rule deleted.");
      showFlash("Rule deleted.");
      if (admin) {
        await loadPage(admin);
      }
    } catch (err: any) {
      console.error("handleDeleteRule error:", err);
      setError(err?.message || "Could not delete rule.");
      setStatus("Delete failed.");
    } finally {
      setDeletingRuleId(null);
    }
  }

  async function handleToggleActive(rule: ValidationRule) {
    try {
      setError(null);
      setStatus(rule.is_active ? "Disabling rule..." : "Enabling rule...");
      const { error } = await supabase
        .from("validation_rules")
        .update({ is_active: !rule.is_active })
        .eq("id", rule.id);
      if (error) {
        throw error;
      }
      showFlash(rule.is_active ? "Rule disabled." : "Rule enabled.");
      if (admin) {
        await loadPage(admin);
      }
    } catch (err: any) {
      console.error("handleToggleActive error:", err);
      setError(err?.message || "Could not update rule status.");
      setStatus("Update failed.");
    }
  }

  const filteredRules = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return rules;
    }
    return rules.filter((rule) =>
      [
        rule.field_name,
        rule.rule_type,
        rule.rule_value,
        rule.message,
        rule.severity,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [rules, search]);

  // Shared per-rule rendering, reused by both the desktop DataTable cells
  // and the compact-viewport ResponsiveList item below so the two
  // presentations can never drift out of sync with each other.
  function renderSeverityBadge(rule: ValidationRule) {
    return (
      <StatusBadge tone={rule.severity === "error" ? "danger" : "warning"}>
        {rule.severity.toUpperCase()}
      </StatusBadge>
    );
  }

  function renderRuleActions(rule: ValidationRule) {
    const deleting = deletingRuleId === rule.id;
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => startEditRule(rule)}
          style={secondaryButtonStyle}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => void handleToggleActive(rule)}
          style={secondaryButtonStyle}
        >
          {rule.is_active ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          onClick={() => void handleDeleteRule(rule.id)}
          style={dangerButtonStyle}
          disabled={deleting}
        >
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <PageNavigation
        homeHref="/admin/dashboard"
        homeLabel="Dashboard"
        parentHref="/admin/attendees"
        parentLabel="Attendees"
      />

      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>{pageTitle}</h1>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            Superadmin rule editor for Data Review and future validation checks.
            {currentEvent?.name || currentEvent?.eventName
              ? ` Current admin event: ${currentEvent.name || currentEvent.eventName}`
              : ""}
          </div>
          <div style={{ marginTop: 12, fontSize: 14 }}>{status}</div>
          {flashMessage ? (
            <div style={successBoxStyle}>{flashMessage}</div>
          ) : null}
          {error ? <div style={errorBoxStyle}>{error}</div> : null}
      </div>

        <div className="card" style={{ padding: 18 }}>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "minmax(260px, 1fr) auto",
              alignItems: "end",
            }}
          >
            <Field label="Search Rules">
              {(props) => (
                <Input
                  {...props}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search field, type, message..."
                />
              )}
            </Field>
            <button
              type="button"
              onClick={startNewRule}
              style={secondaryButtonStyle}
            >
              New Rule
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>
            {form.id ? "Edit Rule" : "Create Rule"}
          </h2>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <Field label="Field">
              {(props) => (
                <Select
                  {...props}
                  value={form.field_name}
                  onChange={(e) => updateForm("field_name", e.target.value)}
                >
                  <option value="membership_number">Membership Number</option>
                  <option value="email">Email</option>
                  <option value="pilot_first">Pilot First Name</option>
                  <option value="pilot_last">Pilot Last Name</option>
                  <option value="copilot_first">Co-Pilot First Name</option>
                  <option value="copilot_last">Co-Pilot Last Name</option>
                  <option value="city">City</option>
                  <option value="state">State</option>
                </Select>
              )}
            </Field>
            <Field label="Rule Type">
              {(props) => (
                <Select
                  {...props}
                  value={form.rule_type}
                  onChange={(e) => updateForm("rule_type", e.target.value)}
                >
                  <option value="required">Required</option>
                  <option value="starts_with">Starts With</option>
                  <option value="starts_with_any">Starts With Any</option>
                  <option value="contains">Contains</option>
                  <option value="min_length">Minimum Length</option>
                </Select>
              )}
            </Field>
            <Field label="Rule Value">
              {(props) => (
                <Input
                  {...props}
                  value={form.rule_value}
                  onChange={(e) => updateForm("rule_value", e.target.value)}
                  placeholder={
                    form.rule_type === "required"
                      ? "Not used for required"
                      : "Enter value"
                  }
                  disabled={form.rule_type === "required"}
                />
              )}
            </Field>
            <Field label="Severity">
              {(props) => (
                <Select
                  {...props}
                  value={form.severity}
                  onChange={(e) =>
                    updateForm("severity", e.target.value as ValidationSeverity)
                  }
                >
                  <option value="error">Error</option>
                  <option value="warning">Warning</option>
                </Select>
              )}
            </Field>
            <Field label="Priority">
              {(props) => (
                <Input
                  {...props}
                  value={form.priority}
                  onChange={(e) => updateForm("priority", e.target.value)}
                  placeholder="Lower runs first"
                />
              )}
            </Field>
            <Field label="Scope">
              {(props) => (
                <Select
                  {...props}
                  value={form.applies_to_event_id}
                  onChange={(e) =>
                    updateForm("applies_to_event_id", e.target.value)
                  }
                >
                  <option value="">All Events</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {formatEventLabel(event)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label="Message">
              {(props) => (
                <Textarea
                  {...props}
                  value={form.message}
                  onChange={(e) => updateForm("message", e.target.value)}
                  rows={3}
                  placeholder="Message shown in Data Review"
                />
              )}
            </Field>
          </div>
          <div
            style={{
              marginTop: 14,
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <Checkbox
              checked={form.is_active}
              onChange={(e) => updateForm("is_active", e.target.checked)}
              label="Rule is active"
            />
          </div>
          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => void handleSaveRule()}
              style={primaryButtonStyle}
              disabled={saving}
            >
              {saving ? "Saving..." : form.id ? "Update Rule" : "Create Rule"}
            </button>
            <button
              type="button"
              onClick={startNewRule}
              style={secondaryButtonStyle}
              disabled={saving}
            >
              Clear Form
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 18 }}>
          <div style={{ marginBottom: 14 }}>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Rules</h2>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {filteredRules.length} visible rule
              {filteredRules.length === 1 ? "" : "s"}
            </div>
          </div>
          {loading ? (
            <LoadingState message="Loading..." />
          ) : filteredRules.length === 0 ? (
            <EmptyState message="No validation rules found." />
          ) : isCompact ? (
            <ResponsiveList aria-label="Validation rules">
              {filteredRules.map((rule) => (
                <li key={rule.id} className="responsive-list-item">
                  <div className="responsive-list-item-header">
                    <div className="responsive-list-item-title">
                      {fieldLabel(rule.field_name)}
                    </div>
                    {renderSeverityBadge(rule)}
                  </div>

                  <div className="responsive-list-item-meta">
                    <span>{ruleTypeLabel(rule.rule_type)}</span>
                    <span>Value: {rule.rule_value || "—"}</span>
                  </div>

                  <div className="responsive-list-item-meta">
                    <span>{rule.message}</span>
                  </div>

                  <div className="responsive-list-item-meta">
                    <span>Priority {rule.priority}</span>
                    <span>{scopeLabel(rule, events)}</span>
                    <span>Active: {rule.is_active ? "Yes" : "No"}</span>
                  </div>

                  {renderRuleActions(rule)}
                </li>
              ))}
            </ResponsiveList>
          ) : (
            <DataTable caption="Validation rules">
              <thead>
                <tr>
                  <th scope="col" style={thStyle}>Field</th>
                  <th scope="col" style={thStyle}>Type</th>
                  <th scope="col" style={thStyle}>Value</th>
                  <th scope="col" style={thStyle}>Message</th>
                  <th scope="col" style={thStyle}>Severity</th>
                  <th scope="col" style={thStyle}>Priority</th>
                  <th scope="col" style={thStyle}>Scope</th>
                  <th scope="col" style={thStyle}>Active</th>
                  <th scope="col" style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.map((rule) => (
                  <tr key={rule.id}>
                    <td style={tdStyle}>{fieldLabel(rule.field_name)}</td>
                    <td style={tdStyle}>{ruleTypeLabel(rule.rule_type)}</td>
                    <td style={tdStyle}>{rule.rule_value || "—"}</td>
                    <td style={tdStyle}>{rule.message}</td>
                    <td style={tdStyle}>{renderSeverityBadge(rule)}</td>
                    <td style={tdStyle}>{rule.priority}</td>
                    <td style={tdStyle}>{scopeLabel(rule, events)}</td>
                    <td style={tdStyle}>{rule.is_active ? "Yes" : "No"}</td>
                    <td style={tdStyle}>{renderRuleActions(rule)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </div>
    </div>
  );
}

function AdminValidationRulesPageContent() {
  return (
    <AdminRouteGuard requiredTask="event.validation_rules.manage">
      <AdminShellAdapter pageTitle="Validation Rules">
        <AdminValidationRulesPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};
const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};
const dangerButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ef4444",
  background: "#fff1f2",
  color: "#b91c1c",
  fontWeight: 700,
  cursor: "pointer",
};
const errorBoxStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2b4b4",
  background: "#fff3f3",
  color: "#8a1f1f",
};
const successBoxStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #bbf7d0",
  background: "#f0fdf4",
  color: "#166534",
};
const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "2px solid #ddd",
  whiteSpace: "nowrap",
  verticalAlign: "top",
  fontSize: 12,
  lineHeight: 1.2,
};
const tdStyle: CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderTop: "1px solid #ddd",
  verticalAlign: "top",
  whiteSpace: "normal",
};

export default function AdminValidationRulesPage() {
  return (
    <Suspense
      fallback={
        <div className="card" style={{ padding: 18 }}>
          Loading validation rules...
        </div>
      }
    >
      <AdminValidationRulesPageContent />
    </Suspense>
  );
}
