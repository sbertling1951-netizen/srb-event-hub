"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  type AreaListCandidate,
  areaListCandidateTypeOptions,
  filterAreaListCandidates,
  groupAreaListCandidates,
  pruneSelectionToFiltered,
  selectableAreaListCandidateIds,
} from "@/lib/nearbyAreaListPicker";
import { supabase } from "@/lib/supabase";

type AreaList = {
  id: string;
  name: string;
  description: string | null;
  scope: "shared_public" | "tenant_specific";
  tenant_id: string | null;
  is_active: boolean;
  can_manage: boolean;
};

type AreaListMember = {
  membership_id: string;
  nearby_master_id: string;
  name: string;
  category_id: string | null;
  category_label: string | null;
  is_active: boolean;
  google_place_id: string | null;
};

type CanonicalPlace = AreaListCandidate;

type NearbyAreaListManagerProps = {
  selectedTenantId: string;
  isPlatformAdmin: boolean;
};

/**
 * The list manager speaks exclusively to the Area List RPC surface. The
 * existing Stored Area and Nearby master editors remain untouched; this is
 * a separate reusable-list workflow, not a reinterpretation of either.
 */
export function NearbyAreaListManager({
  selectedTenantId,
  isPlatformAdmin,
}: NearbyAreaListManagerProps) {
  const [lists, setLists] = useState<AreaList[]>([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [members, setMembers] = useState<AreaListMember[]>([]);
  const [candidates, setCandidates] = useState<CanonicalPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [newScope, setNewScope] = useState<"shared_public" | "tenant_specific">(
    isPlatformAdmin && !selectedTenantId ? "shared_public" : "tenant_specific",
  );
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [googlePlaceIdDrafts, setGooglePlaceIdDrafts] = useState<Record<string, string>>({});

  // "Add eligible Stored Place" picker -- display organization only. The
  // governed read already scoped what this admin may add; these controls
  // just make a large authorized set navigable (Area -> marker type ->
  // name) without ever widening or bypassing it.
  const [pickerNameQuery, setPickerNameQuery] = useState("");
  const [pickerCategoryKeys, setPickerCategoryKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pickerSelectedIds, setPickerSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const selectedList = useMemo(
    () => lists.find((list) => list.id === selectedListId) ?? null,
    [lists, selectedListId],
  );

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      "list_nearby_area_lists_for_administration",
      { p_tenant_id: selectedTenantId || null },
    );
    setLoading(false);

    if (rpcError) {
      setLists([]);
      setSelectedListId("");
      setError("Could not load governed Nearby Area Lists.");
      return;
    }

    const nextLists = (data || []) as AreaList[];
    setLists(nextLists);
    setSelectedListId((current) => (
      current && nextLists.some((list) => list.id === current)
        ? current
        : nextLists[0]?.id || ""
    ));
  }, [selectedTenantId]);

  const loadSelectedListDetail = useCallback(async () => {
    if (!selectedList?.can_manage) {
      setMembers([]);
      setCandidates([]);
      return;
    }

    const [membersResponse, candidatesResponse] = await Promise.all([
      supabase.rpc("list_nearby_area_list_members_for_administration", {
        p_area_list_id: selectedList.id,
      }),
      supabase.rpc("list_nearby_master_places_for_area_list", {
        p_area_list_id: selectedList.id,
      }),
    ]);

    if (membersResponse.error || candidatesResponse.error) {
      setMembers([]);
      setCandidates([]);
      setError("Could not load the governed Area List membership.");
      return;
    }

    setMembers((membersResponse.data || []) as AreaListMember[]);
    setCandidates((candidatesResponse.data || []) as CanonicalPlace[]);
  }, [selectedList]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    setNewScope(isPlatformAdmin && !selectedTenantId ? "shared_public" : "tenant_specific");
  }, [isPlatformAdmin, selectedTenantId]);

  useEffect(() => {
    if (!selectedList) {
      setEditingName("");
      setEditingDescription("");
      setMembers([]);
      setCandidates([]);
      return;
    }
    setEditingName(selectedList.name);
    setEditingDescription(selectedList.description || "");
    void loadSelectedListDetail();
  }, [selectedList, loadSelectedListDetail]);

  // Reset the picker's transient controls whenever the selected list
  // changes -- filters and selection are per-list.
  useEffect(() => {
    setPickerNameQuery("");
    setPickerCategoryKeys(new Set());
    setPickerSelectedIds(new Set());
  }, [selectedListId]);

  async function createList() {
    if (!newName.trim()) {
      setError("Area List name is required.");
      return;
    }
    if (newScope === "tenant_specific" && !selectedTenantId) {
      setError("Select a Tenant before creating a Tenant Area List.");
      return;
    }

    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("create_nearby_area_list", {
      p_scope: newScope,
      p_tenant_id: newScope === "tenant_specific" ? selectedTenantId : null,
      p_name: newName.trim(),
      p_description: newDescription.trim() || null,
    });
    setBusy(false);

    if (rpcError) {
      setError("Could not create the governed Area List. Check the selected scope and authority.");
      return;
    }

    const created = data as { id?: string } | null;
    setNewName("");
    setNewDescription("");
    setStatus("Area List created.");
    await loadLists();
    if (created?.id) {
      setSelectedListId(created.id);
    }
  }

  async function saveList() {
    if (!selectedList || !editingName.trim()) {
      setError("Area List name is required.");
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("update_nearby_area_list", {
      p_area_list_id: selectedList.id,
      p_name: editingName.trim(),
      p_description: editingDescription.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      setError("Could not save this Area List.");
      return;
    }
    setStatus("Area List saved.");
    await loadLists();
  }

  async function retireList() {
    if (!selectedList) {
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("retire_nearby_area_list", {
      p_area_list_id: selectedList.id,
    });
    setBusy(false);
    if (rpcError) {
      setError("Could not retire this Area List.");
      return;
    }
    setStatus("Area List retired. Existing Event curation is unchanged.");
    await loadLists();
  }

  async function setMembership(nearbyMasterId: string, isActive: boolean) {
    if (!selectedList) {
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("set_nearby_area_list_membership", {
      p_area_list_id: selectedList.id,
      p_nearby_master_id: nearbyMasterId,
      p_is_active: isActive,
    });
    setBusy(false);
    if (rpcError) {
      setError("Could not update Area List membership.");
      return;
    }
    setStatus(isActive ? "Canonical place is active in this Area List." : "Area List membership removed.");
    await loadSelectedListDetail();
  }

  async function linkGooglePlaceId(nearbyMasterId: string) {
    const googlePlaceId = googlePlaceIdDrafts[nearbyMasterId]?.trim();
    if (!googlePlaceId) {
      setError("Enter the exact Google Place ID to link it.");
      return;
    }
    setBusy(true);
    const { error: rpcError } = await supabase.rpc("link_google_place_id_to_nearby_master", {
      p_nearby_master_id: nearbyMasterId,
      p_google_place_id: googlePlaceId,
    });
    setBusy(false);
    if (rpcError) {
      setError("Could not link that Google Place ID. IDs must be exact and unique.");
      return;
    }
    setStatus("Exact Google Place ID linked to the canonical place.");
    setGooglePlaceIdDrafts((current) => ({ ...current, [nearbyMasterId]: "" }));
    await loadSelectedListDetail();
  }

  const activeMemberIds = useMemo(
    () =>
      new Set(
        members
          .filter((member) => member.is_active)
          .map((member) => member.nearby_master_id),
      ),
    [members],
  );

  // Marker/place-type filter options -- the live place_categories
  // vocabulary as it actually appears in this list's eligible candidates.
  const pickerTypeOptions = useMemo(
    () => areaListCandidateTypeOptions(candidates),
    [candidates],
  );

  // Eligible candidates after the membership exclusion + name + type
  // filters. Never widens past what the RPC returned.
  const filteredCandidates = useMemo(
    () =>
      filterAreaListCandidates(candidates, {
        nameQuery: pickerNameQuery,
        categoryKeys: pickerCategoryKeys,
        activeMemberIds,
      }),
    [candidates, pickerNameQuery, pickerCategoryKeys, activeMemberIds],
  );

  const groupedCandidates = useMemo(
    () => groupAreaListCandidates(filteredCandidates),
    [filteredCandidates],
  );

  // A selection can only ever contain rows currently visible in the
  // filtered set -- so a filtered-out row can never be batch-added.
  useEffect(() => {
    setPickerSelectedIds((current) => {
      const pruned = pruneSelectionToFiltered(current, filteredCandidates);
      return pruned.size === current.size ? current : pruned;
    });
  }, [filteredCandidates]);

  function togglePickerType(key: string) {
    setPickerCategoryKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function togglePickerSelection(nearbyMasterId: string) {
    setPickerSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(nearbyMasterId)) {
        next.delete(nearbyMasterId);
      } else {
        next.add(nearbyMasterId);
      }
      return next;
    });
  }

  function selectAllFilteredCandidates() {
    setPickerSelectedIds(new Set(selectableAreaListCandidateIds(filteredCandidates)));
  }

  function deselectAllFilteredCandidates() {
    setPickerSelectedIds(new Set());
  }

  // Batch add -- each place goes through the SAME governed membership
  // operation as the single-row button, one call per place, sequentially.
  // No new bypass, no direct table write; per-row authority is re-checked
  // server-side on every call.
  async function addSelectedCandidatesToList() {
    if (!selectedList) {
      return;
    }
    const ids = selectableAreaListCandidateIds(filteredCandidates).filter((id) =>
      pickerSelectedIds.has(id),
    );
    if (ids.length === 0) {
      setError("Select at least one place to add.");
      return;
    }

    setBusy(true);
    setError(null);
    let added = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const { error: rpcError } = await supabase.rpc("set_nearby_area_list_membership", {
        p_area_list_id: selectedList.id,
        p_nearby_master_id: id,
        p_is_active: true,
      });
      if (rpcError) {
        failed.push(id);
      } else {
        added += 1;
      }
    }
    setBusy(false);
    setPickerSelectedIds(new Set());

    if (failed.length > 0) {
      setError(
        `Added ${added} place${added === 1 ? "" : "s"}; ${failed.length} could not be added. Check authority and try again.`,
      );
    } else {
      setStatus(`Added ${added} place${added === 1 ? "" : "s"} to this Area List.`);
    }
    await loadSelectedListDetail();
  }

  return (
    <PageSection title="Reusable Nearby Area Lists" variant="card">
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <Alert tone="neutral">
          Area Lists reuse existing canonical places. They never replace Stored Areas or Event-specific Nearby curation.
        </Alert>

        {error ? <Alert tone="danger">{error}</Alert> : null}
        {status ? <Alert tone="success">{status}</Alert> : null}

        <div className="app-form-grid-2">
          <Field label="Area List scope">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={newScope}
                onChange={(event) => setNewScope(event.target.value as "shared_public" | "tenant_specific")}
                disabled={busy}
              >
                {isPlatformAdmin ? <option value="shared_public">Shared (Platform managed)</option> : null}
                <option value="tenant_specific" disabled={!selectedTenantId}>This Tenant</option>
              </Select>
            )}
          </Field>
          <Field label="Area List name" required>
            {(controlProps) => (
              <Input {...controlProps} value={newName} onChange={(event) => setNewName(event.target.value)} disabled={busy} />
            )}
          </Field>
        </div>
        <Field label="Description">
          {(controlProps) => (
            <Textarea {...controlProps} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} disabled={busy} />
          )}
        </Field>
        <FormActions>
          <AppButton variant="primary" onClick={() => void createList()} loading={busy}>Create Area List</AppButton>
        </FormActions>

        {loading ? <LoadingState message="Loading governed Area Lists..." /> : null}
        {!loading && lists.length === 0 ? <EmptyState message="No governed Area Lists are available in this scope." /> : null}
        {lists.length > 0 ? (
          <Field label="Area List">
            {(controlProps) => (
              <Select {...controlProps} value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)}>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}{list.scope === "shared_public" ? " — Shared" : " — Tenant"}{list.is_active ? "" : " — Retired"}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {selectedList && !selectedList.can_manage ? (
          <Alert tone="neutral">This Shared Area List is available for Event application, but only Platform Administrators can maintain it.</Alert>
        ) : null}

        {selectedList?.can_manage ? (
          <>
            <div className="app-form-grid-2">
              <Field label="Area List name" required>
                {(controlProps) => (
                  <Input {...controlProps} value={editingName} onChange={(event) => setEditingName(event.target.value)} disabled={busy || !selectedList.is_active} />
                )}
              </Field>
              <Field label="Description">
                {(controlProps) => (
                  <Textarea {...controlProps} value={editingDescription} onChange={(event) => setEditingDescription(event.target.value)} disabled={busy || !selectedList.is_active} />
                )}
              </Field>
            </div>
            <FormActions>
              <AppButton variant="primary" onClick={() => void saveList()} loading={busy} disabled={!selectedList.is_active}>Save Area List</AppButton>
              <AppButton variant="danger" onClick={() => void retireList()} loading={busy} disabled={!selectedList.is_active}>Retire Area List</AppButton>
            </FormActions>

            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              <h3 className="app-section-title">Membership</h3>
              {members.length === 0 ? <EmptyState message="No canonical places are in this Area List yet." /> : null}
              {members.map((member) => (
                <div key={member.membership_id} className="app-card-section" style={{ display: "grid", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    <div>
                      <strong>{member.name}</strong>
                      <div className="app-subtle-text">{member.category_label || "Uncategorized"}</div>
                    </div>
                    <StatusBadge tone={member.is_active ? "success" : "neutral"}>{member.is_active ? "Active" : "Removed"}</StatusBadge>
                  </div>
                  {member.google_place_id ? (
                    <Alert tone="neutral">Exact Google Place ID linked.</Alert>
                  ) : (
                    <div className="app-form-grid-2">
                      <Field label="Exact Google Place ID">
                        {(controlProps) => (
                          <Input
                            {...controlProps}
                            value={googlePlaceIdDrafts[member.nearby_master_id] || ""}
                            onChange={(event) => setGooglePlaceIdDrafts((current) => ({ ...current, [member.nearby_master_id]: event.target.value }))}
                            placeholder="Google Place ID"
                            disabled={busy}
                          />
                        )}
                      </Field>
                      <FormActions>
                        <AppButton onClick={() => void linkGooglePlaceId(member.nearby_master_id)} loading={busy}>Link exact Google ID</AppButton>
                      </FormActions>
                    </div>
                  )}
                  <FormActions>
                    <AppButton onClick={() => void setMembership(member.nearby_master_id, !member.is_active)} loading={busy} disabled={!selectedList.is_active}>
                      {member.is_active ? "Remove from Area List" : "Reactivate Membership"}
                    </AppButton>
                  </FormActions>
                </div>
              ))}
            </div>

            {selectedList.is_active ? (
              <div style={{ display: "grid", gap: "var(--space-3)" }}>
                <h3 className="app-section-title">Add eligible Stored Place</h3>
                <Alert tone="neutral">
                  Every place you are authorized to add to this Area List, organized by geographic Area, then marker type. Places from other Areas are shown, not hidden -- this is display organization, not an authority limit.
                </Alert>

                {candidates.length === 0 ? (
                  <EmptyState message="No eligible canonical places are available for this Area List." />
                ) : (
                  <>
                    <div style={{ display: "grid", gap: "var(--space-2)" }}>
                      <Field label="Filter by place name">
                        {(controlProps) => (
                          <Input
                            {...controlProps}
                            value={pickerNameQuery}
                            onChange={(event) => setPickerNameQuery(event.target.value)}
                            placeholder="Type part of a place name"
                            disabled={busy}
                          />
                        )}
                      </Field>

                      {pickerTypeOptions.length > 0 ? (
                        <div style={{ display: "grid", gap: "var(--space-1)" }}>
                          <div className="app-subtle-text" style={{ fontSize: 13 }}>
                            Filter by marker type
                            {pickerCategoryKeys.size > 0 ? ` (${pickerCategoryKeys.size} selected)` : " (all)"}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2) var(--space-4)" }}>
                            {pickerTypeOptions.map((option) => (
                              <Checkbox
                                key={option.key}
                                label={option.label}
                                checked={pickerCategoryKeys.has(option.key)}
                                onChange={() => togglePickerType(option.key)}
                                disabled={busy}
                              />
                            ))}
                          </div>
                          {pickerCategoryKeys.size > 0 ? (
                            <AppButton
                              onClick={() => setPickerCategoryKeys(new Set())}
                              disabled={busy}
                              style={{ width: "fit-content" }}
                            >
                              Clear type filter
                            </AppButton>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="app-subtle-text" style={{ fontSize: 13 }}>
                      Showing {filteredCandidates.length} of {candidates.length} eligible place
                      {candidates.length === 1 ? "" : "s"}
                      {pickerSelectedIds.size > 0 ? ` -- ${pickerSelectedIds.size} selected` : ""}.
                    </div>

                    <FormActions>
                      <AppButton
                        onClick={selectAllFilteredCandidates}
                        disabled={busy || filteredCandidates.length === 0}
                      >
                        Select all shown
                      </AppButton>
                      <AppButton
                        onClick={deselectAllFilteredCandidates}
                        disabled={busy || pickerSelectedIds.size === 0}
                      >
                        Deselect all
                      </AppButton>
                      <AppButton
                        variant="primary"
                        onClick={() => void addSelectedCandidatesToList()}
                        loading={busy}
                        disabled={pickerSelectedIds.size === 0}
                      >
                        Add {pickerSelectedIds.size > 0 ? `${pickerSelectedIds.size} ` : ""}selected to Area List
                      </AppButton>
                    </FormActions>

                    {groupedCandidates.length === 0 ? (
                      <EmptyState message="No eligible places match the current filters." />
                    ) : (
                      groupedCandidates.map((areaGroup) => (
                        <div
                          key={areaGroup.key}
                          className="app-card-section"
                          style={{ display: "grid", gap: "var(--space-2)" }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
                            <strong>{areaGroup.label}</strong>
                            <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center", flexWrap: "wrap" }}>
                              {areaGroup.isUnassigned ? (
                                <StatusBadge tone="neutral">No geographic Area</StatusBadge>
                              ) : null}
                              <AppButton
                                onClick={() =>
                                  setPickerSelectedIds((current) => {
                                    const next = new Set(current);
                                    for (const place of areaGroup.places) {
                                      next.add(place.nearby_master_id);
                                    }
                                    return next;
                                  })
                                }
                                disabled={busy}
                              >
                                Select this Area ({areaGroup.places.length})
                              </AppButton>
                            </div>
                          </div>

                          {areaGroup.typeGroups.map((typeGroup) => (
                            <div key={typeGroup.key} style={{ display: "grid", gap: "var(--space-1)" }}>
                              <div className="app-subtle-text" style={{ fontSize: 13, fontWeight: 600 }}>
                                {typeGroup.label}
                              </div>
                              {typeGroup.places.map((candidate) => (
                                <div
                                  key={candidate.nearby_master_id}
                                  style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap", paddingLeft: "var(--space-2)" }}
                                >
                                  <Checkbox
                                    label={candidate.name}
                                    checked={pickerSelectedIds.has(candidate.nearby_master_id)}
                                    onChange={() => togglePickerSelection(candidate.nearby_master_id)}
                                    disabled={busy}
                                  />
                                  <AppButton
                                    onClick={() => void setMembership(candidate.nearby_master_id, true)}
                                    loading={busy}
                                  >
                                    Add to Area List
                                  </AppButton>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </PageSection>
  );
}
