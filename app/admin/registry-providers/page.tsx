"use client";

import { useCallback, useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { LoadingState } from "@/components/ui/LoadingState";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  createRegistryProviderCatalogAsset,
  emptyRegistryProviderCatalogAssetInput,
  listRegistryProviderCatalogAssetsForPlatformAdmin,
  registryProviderCatalogAssetError,
  type RegistryProviderCatalogAssetInput,
  type RegistryProviderCatalogAssetRow,
  registryProviderCatalogAssetValues,
  setRegistryProviderCatalogAssetActiveStatus,
  updateRegistryProviderCatalogAsset,
} from "@/lib/registryProviderCatalogAdmin";

// P1 privacy/scope notice. States plainly what this workspace is and is not:
// a curation surface only, with no organizer-facing counterpart yet.
const SCOPE_COPY =
  "This is the platform catalog itself -- a Platform-Admin-only curation workspace. Organizers cannot search, " +
  "browse, or select from this catalog yet; that is a separate, later, separately authorized capability. A new " +
  "provider starts inactive and is never visible anywhere until you explicitly activate it.";

const EMPTY_COPY = "No registry providers exist yet. Add one below whenever you like.";

/**
 * A provider's public website is rendered as plain text only -- never a
 * link, never an <a href>, never fetched, opened, previewed, or unfurled.
 * See docs/architecture/EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md
 * §3: "never fetched, opened, previewed, crawled, or externally validated."
 */
function WebsiteText({ value }: { value: string }) {
  return <span style={{ wordBreak: "break-all" }}>{value}</span>;
}

function AssetFields({
  values,
  onChange,
}: {
  values: RegistryProviderCatalogAssetInput;
  onChange: (next: RegistryProviderCatalogAssetInput) => void;
}) {
  return (
    <>
      <Field label="Provider name" required>
        {(props) => (
          <Input
            {...props}
            value={values.providerName}
            onChange={(event) => onChange({ ...values, providerName: event.target.value })}
          />
        )}
      </Field>
      <Field label="Short public description" required>
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            value={values.shortDescription}
            onChange={(event) => onChange({ ...values, shortDescription: event.target.value })}
          />
        )}
      </Field>
      <Field
        label="Public provider website"
        required
        help="Plain text only -- EpicentraX never fetches, opens, or previews this."
      >
        {(props) => (
          <Input
            {...props}
            value={values.publicWebsite}
            onChange={(event) => onChange({ ...values, publicWebsite: event.target.value })}
          />
        )}
      </Field>
    </>
  );
}

function RegistryProviderCatalogWorkspace() {
  const [rows, setRows] = useState<RegistryProviderCatalogAssetRow[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addForm, setAddForm] = useState<RegistryProviderCatalogAssetInput>(emptyRegistryProviderCatalogAssetInput());
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RegistryProviderCatalogAssetInput | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const assets = await listRegistryProviderCatalogAssetsForPlatformAdmin();
      setRows(assets);
      setLoadState("ready");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "We could not load the registry provider catalog.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** A stale-revision conflict means our local copy is out of date -- reload. */
  async function recoverFromConflict(message: string) {
    if (message.toLowerCase().includes("changed since you loaded it")) {
      await load();
    }
  }

  async function submitAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = registryProviderCatalogAssetError(addForm);
    if (validationError || adding) {
      setAddError(validationError);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const created = await createRegistryProviderCatalogAsset(addForm);
      setRows((current) => [...current, created].sort((a, b) => a.provider_name.localeCompare(b.provider_name)));
      setAddForm(emptyRegistryProviderCatalogAssetInput());
      setAddOpen(false);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "We could not create that provider.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(row: RegistryProviderCatalogAssetRow) {
    setEditingId(row.id);
    setEditForm(registryProviderCatalogAssetValues(row));
    setEditError(null);
    setRowError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditError(null);
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>, row: RegistryProviderCatalogAssetRow) {
    event.preventDefault();
    if (!editForm) {
      return;
    }
    const validationError = registryProviderCatalogAssetError(editForm);
    if (validationError || savingId) {
      setEditError(validationError);
      return;
    }
    setSavingId(row.id);
    setEditError(null);
    try {
      const saved = await updateRegistryProviderCatalogAsset(row.id, row.revision, editForm);
      setRows((current) => current.map((existing) => (existing.id === saved.id ? saved : existing)));
      cancelEdit();
    } catch (error) {
      const message = error instanceof Error ? error.message : "We could not save that provider.";
      setEditError(message);
      await recoverFromConflict(message);
    } finally {
      setSavingId(null);
    }
  }

  async function toggleActive(row: RegistryProviderCatalogAssetRow) {
    if (busyId) {
      return;
    }
    setBusyId(row.id);
    setRowError(null);
    try {
      const saved = await setRegistryProviderCatalogAssetActiveStatus(row.id, row.revision, !row.is_active);
      setRows((current) => current.map((existing) => (existing.id === saved.id ? saved : existing)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "We could not change that provider's status.";
      setRowError(message);
      await recoverFromConflict(message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Page style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 16 }}>
      <PageHeader title="Registry Provider Catalog" headingLevel="h1" description="Platform-owned catalog curation." />
      <Alert tone="info">{SCOPE_COPY}</Alert>

      {rowError ? <Alert tone="danger">{rowError}</Alert> : null}

      <PageSection title="Providers" variant="section">
        {loadState === "loading" ? <LoadingState message="Loading providers…" /> : null}
        {loadState === "error" ? <Alert tone="danger">{loadError}</Alert> : null}
        {loadState === "ready" ? (
          rows.length === 0 ? (
            <EmptyState message={EMPTY_COPY} />
          ) : (
            <ul style={{ display: "grid", gap: 10, listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((row) => (
                <li key={row.id} className="card" style={{ display: "grid", gap: 8 }}>
                  {editingId === row.id && editForm ? (
                    <form onSubmit={(event) => void submitEdit(event, row)} style={{ display: "grid", gap: 12 }}>
                      {editError ? <Alert tone="danger">{editError}</Alert> : null}
                      <AssetFields values={editForm} onChange={setEditForm} />
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <AppButton type="submit" variant="primary" loading={savingId === row.id}>
                          Save changes
                        </AppButton>
                        <AppButton type="button" onClick={cancelEdit} disabled={savingId === row.id}>
                          Cancel
                        </AppButton>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                        <strong>{row.provider_name}</strong>
                        <StatusBadge tone={row.is_active ? "success" : "neutral"}>
                          {row.is_active ? "Active" : "Inactive"}
                        </StatusBadge>
                      </div>
                      <p style={{ margin: 0 }}>{row.short_description}</p>
                      <WebsiteText value={row.public_website} />
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <AppButton onClick={() => startEdit(row)}>Edit</AppButton>
                        <AppButton
                          variant={row.is_active ? "danger" : "primary"}
                          loading={busyId === row.id}
                          onClick={() => void toggleActive(row)}
                        >
                          {row.is_active ? "Deactivate" : "Activate"}
                        </AppButton>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </PageSection>

      <PageSection title="Add a registry provider" variant="card">
        {addOpen ? (
          <form onSubmit={submitAdd} style={{ display: "grid", gap: 12 }}>
            {addError ? <Alert tone="danger">{addError}</Alert> : null}
            <AssetFields values={addForm} onChange={setAddForm} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <AppButton type="submit" variant="primary" loading={adding}>
                Add provider
              </AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  setAddOpen(false);
                  setAddForm(emptyRegistryProviderCatalogAssetInput());
                  setAddError(null);
                }}
                disabled={adding}
              >
                Cancel
              </AppButton>
            </div>
          </form>
        ) : (
          <AppButton onClick={() => setAddOpen(true)}>Add a registry provider</AppButton>
        )}
      </PageSection>
    </Page>
  );
}

export default function RegistryProviderCatalogPage() {
  return (
    <AdminRouteGuard requiredPlatformAuthority>
      <AdminShellAdapter
        pageTitle="Registry Provider Catalog"
        pageSubtitle="Platform-owned catalog curation -- no organizer-facing surface yet"
      >
        <RegistryProviderCatalogWorkspace />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}
