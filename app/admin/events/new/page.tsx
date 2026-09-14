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
import {
  planCoordinatePersistence,
  resolveEventCoordinates,
} from "@/lib/eventCoordinates";
import { createEventForTenant } from "@/lib/eventProvisioning";
import { geocodeLocation } from "@/lib/geocodeLocation";

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

const US_TIMEZONES = [
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Chicago", label: "Central — Chicago" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Phoenix", label: "Mountain (no daylight saving) — Phoenix" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
];

const CANADA_TIMEZONES = [
  { value: "America/Toronto", label: "Eastern — Toronto" },
  { value: "America/Winnipeg", label: "Central — Winnipeg" },
  { value: "America/Regina", label: "Central (no daylight saving) — Regina" },
  { value: "America/Edmonton", label: "Mountain — Edmonton" },
  { value: "America/Vancouver", label: "Pacific — Vancouver" },
  { value: "America/Whitehorse", label: "Yukon — Whitehorse" },
  { value: "America/Halifax", label: "Atlantic — Halifax" },
  { value: "America/St_Johns", label: "Newfoundland — St. John's" },
];

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
  // Non-blocking notice shown after a successful create whose coordinates
  // could not be resolved -- the Event exists; coordinates need manual entry.
  const [coordinateNotice, setCoordinateNotice] = useState<string | null>(null);
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

      setSaving(true);

      // Third-party geocoder success is NOT a prerequisite for creating an
      // Event. A manual pair is validated (partial / out-of-range still fail
      // visibly via resolveEventCoordinates); a resolvable location is
      // geocoded; an unresolved location creates the Event with NULL
      // coordinates and a non-blocking notice.
      const coordinatePlan = planCoordinatePersistence(
        await resolveEventCoordinates(form, ({ address }) =>
          geocodeLocation({ address }),
        ),
        "create",
      );

      const created = await createEventForTenant({
        tenantId: form.tenantId,
        name: form.name,
        endDate: form.endDate,
        timezone: form.timezone,
        startDate: form.startDate,
        location: form.location,
        eventCode: form.eventCode,
        lat: coordinatePlan.kind === "write" ? coordinatePlan.lat : null,
        lng: coordinatePlan.kind === "write" ? coordinatePlan.lng : null,
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

      if (coordinatePlan.notice) {
        setCoordinateNotice(coordinatePlan.notice);
        return;
      }

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
      ) : coordinateNotice ? (
        <PageSection variant="card" title="Event created">
          <Alert tone="warning">{coordinateNotice}</Alert>
          <FormActions>
            <AppLinkButton href="/admin/events" variant="primary">
              Open Event Admin
            </AppLinkButton>
          </FormActions>
        </PageSection>
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
                    onChange={(event) => updateField("location", event.target.value)}
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
                help="Choose the timezone where the Event takes place."
              >
                {(controlProps) => (
                  <Select
                    {...controlProps}
                    value={form.timezone}
                    onChange={(event) =>
                      updateField("timezone", event.target.value)
                    }
                    disabled={saving}
                    required
                  >
                    <option value="">Select a timezone</option>
                    <optgroup label="United States">
                      {US_TIMEZONES.map((timezone) => (
                        <option key={timezone.value} value={timezone.value}>
                          {timezone.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Canada">
                      {CANADA_TIMEZONES.map((timezone) => (
                        <option key={timezone.value} value={timezone.value}>
                          {timezone.label}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                )}
              </Field>

              <Field label="Latitude" help="Optional manual override; enter both coordinates or neither.">
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
