"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import { Field, Input, Select } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { Page } from "@/components/ui/Page";
import { PageSection } from "@/components/ui/PageSection";
import { setCurrentAdminEvent } from "@/lib/adminEventContext";
import {
  listMyTenantAdminAccess,
  type MyTenantAdminAccessRow,
} from "@/lib/adminTenantAuthority";
import { createEventForTenant } from "@/lib/eventProvisioning";

type EventFormState = {
  tenantId: string;
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  timezone: string;
  eventCode: string;
  lat: string;
  lng: string;
};

const EMPTY_FORM: EventFormState = {
  tenantId: "",
  name: "",
  location: "",
  startDate: "",
  endDate: "",
  timezone: "",
  eventCode: "",
  lat: "",
  lng: "",
};

function parseCoordinate(value: string, label: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a number.`);
  }

  return parsed;
}

export default function NewEventPage() {
  return (
    <AdminRouteGuard requiredTenantAuthority>
      <AdminShellAdapter
        pageTitle="Add Event"
        pageSubtitle="Create one Event under explicit Tenant ownership."
        backTarget={{ href: "/admin/dashboard", label: "Dashboard" }}
      >
        <NewEventPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function NewEventPageInner() {
  const router = useRouter();
  const [tenants, setTenants] = useState<MyTenantAdminAccessRow[]>([]);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<EventFormState>(EMPTY_FORM);

  useEffect(() => {
    let active = true;

    void listMyTenantAdminAccess()
      .then((rows) => {
        if (!active) {
          return;
        }

        setTenants(rows);
        if (rows.length === 1) {
          setForm((current) =>
            current.tenantId
              ? current
              : { ...current, tenantId: rows[0].tenant_id },
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoadingTenants(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  function updateField<K extends keyof EventFormState>(
    key: K,
    value: EventFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      if (!form.tenantId) {
        throw new Error("Select the Tenant that will own this Event.");
      }
      if (!form.name.trim()) {
        throw new Error("Enter an Event name.");
      }
      if (!form.endDate) {
        throw new Error("Enter the Event end date.");
      }
      if (!form.timezone.trim()) {
        throw new Error("Enter a valid IANA Event timezone.");
      }
      if (form.startDate && form.endDate < form.startDate) {
        throw new Error("Event end date cannot be before start date.");
      }

      const lat = parseCoordinate(form.lat, "Latitude");
      const lng = parseCoordinate(form.lng, "Longitude");
      if ((lat === null) !== (lng === null)) {
        throw new Error("Latitude and longitude must be entered together.");
      }
      if (lat !== null && (lat < -90 || lat > 90)) {
        throw new Error("Latitude must be between -90 and 90.");
      }
      if (lng !== null && (lng < -180 || lng > 180)) {
        throw new Error("Longitude must be between -180 and 180.");
      }

      setSaving(true);
      const created = await createEventForTenant({
        tenantId: form.tenantId,
        name: form.name,
        endDate: form.endDate,
        timezone: form.timezone,
        startDate: form.startDate,
        location: form.location,
        eventCode: form.eventCode,
        lat,
        lng,
      });

      setCurrentAdminEvent({
        id: created.id,
        name: created.name,
        eventName: created.name,
        location: created.location,
        venue_name: null,
        start_date: created.start_date,
        end_date: created.end_date,
      });
      router.push("/admin/events");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Failed to create Event.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page>
      {loadingTenants ? (
        <LoadingState message="Loading authorized Tenants..." />
      ) : tenants.length === 0 ? (
        <Alert tone="warning">
          No active Tenant is available for Event creation under your current
          authority.
        </Alert>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <PageSection variant="card" title="Event ownership and details">
            <Alert tone="info">
              The selected Tenant becomes the permanent Event owner. The Event
              starts in the existing operational lifecycle, with Draft status,
              inactive and hidden from Members.
            </Alert>

            {error ? <Alert tone="danger">{error}</Alert> : null}

            <div className="app-form-grid-2" style={{ marginTop: "var(--space-4)" }}>
              <Field
                label="Owning Tenant"
                required
                help="Tenant ownership cannot be transferred after creation."
              >
                {(controlProps) => (
                  <Select
                    {...controlProps}
                    value={form.tenantId}
                    onChange={(event) =>
                      updateField("tenantId", event.target.value)
                    }
                    disabled={saving}
                    required
                  >
                    <option value="">Select a Tenant</option>
                    {tenants.map((tenant) => (
                      <option key={tenant.tenant_id} value={tenant.tenant_id}>
                        {tenant.display_name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Event Name" required>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    disabled={saving}
                    required
                  />
                )}
              </Field>

              <Field label="Location">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={form.location}
                    onChange={(event) =>
                      updateField("location", event.target.value)
                    }
                    disabled={saving}
                  />
                )}
              </Field>

              <Field label="Event Code" help="Optional; compared without case or surrounding spaces.">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={form.eventCode}
                    onChange={(event) =>
                      updateField("eventCode", event.target.value)
                    }
                    disabled={saving}
                  />
                )}
              </Field>

              <Field label="Start Date">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    type="date"
                    value={form.startDate}
                    onChange={(event) =>
                      updateField("startDate", event.target.value)
                    }
                    disabled={saving}
                  />
                )}
              </Field>

              <Field label="End Date" required>
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    type="date"
                    value={form.endDate}
                    onChange={(event) =>
                      updateField("endDate", event.target.value)
                    }
                    disabled={saving}
                    required
                  />
                )}
              </Field>

              <Field
                label="Event Timezone"
                required
                help="Use an IANA name such as America/Chicago."
              >
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={form.timezone}
                    onChange={(event) =>
                      updateField("timezone", event.target.value)
                    }
                    disabled={saving}
                    placeholder="America/Chicago"
                    required
                  />
                )}
              </Field>

              <Field label="Latitude" help="Optional; enter both coordinates or neither.">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    inputMode="decimal"
                    value={form.lat}
                    onChange={(event) => updateField("lat", event.target.value)}
                    disabled={saving}
                  />
                )}
              </Field>

              <Field label="Longitude" help="Optional; enter both coordinates or neither.">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    inputMode="decimal"
                    value={form.lng}
                    onChange={(event) => updateField("lng", event.target.value)}
                    disabled={saving}
                  />
                )}
              </Field>
            </div>

            <FormActions>
              <AppButton type="submit" variant="primary" loading={saving}>
                Create Event
              </AppButton>
              <AppLinkButton href="/admin/dashboard" variant="secondary">
                Cancel
              </AppLinkButton>
            </FormActions>
          </PageSection>
        </form>
      )}
    </Page>
  );
}
