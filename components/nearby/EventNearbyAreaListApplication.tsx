"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Select } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageSection } from "@/components/ui/PageSection";
import { supabase } from "@/lib/supabase";

type ApplicationList = {
  id: string;
  name: string;
  description: string | null;
  scope: "shared_public" | "tenant_specific";
  tenant_id: string | null;
  uncategorized_member_count: number;
};

type CategoryPreview = {
  category_id: string;
  category_label: string;
  member_count: number;
};

type EventNearbyAreaListApplicationProps = {
  eventId: string | null | undefined;
  onApplied: () => void;
};

/**
 * The "no Area Lists available" empty state is a *successful* result: a
 * working Event with zero eligible lists. It must never render while a load
 * error is showing -- a failed load surfaces only the error, never a
 * simultaneous "successful and empty" message.
 */
export function shouldShowNoListsEmptyState(input: {
  hasEventId: boolean;
  loading: boolean;
  hasError: boolean;
  listCount: number;
}): boolean {
  return (
    input.hasEventId &&
    !input.loading &&
    !input.hasError &&
    input.listCount === 0
  );
}

/** Event-only use of a reusable list; maintenance authority is never inferred here. */
export function EventNearbyAreaListApplication({
  eventId,
  onApplied,
}: EventNearbyAreaListApplicationProps) {
  const [lists, setLists] = useState<ApplicationList[]>([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [categories, setCategories] = useState<CategoryPreview[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const loadLists = useCallback(async () => {
    if (!eventId) {
      setLists([]);
      setSelectedListId("");
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      "list_nearby_area_lists_for_event_application",
      { p_event_id: eventId },
    );
    setLoading(false);
    if (rpcError) {
      setLists([]);
      setSelectedListId("");
      setError("Could not load Area Lists available to this Event.");
      return;
    }
    const nextLists = (data || []) as ApplicationList[];
    setLists(nextLists);
    setSelectedListId((current) => (
      current && nextLists.some((list) => list.id === current)
        ? current
        : nextLists[0]?.id || ""
    ));
  }, [eventId]);

  const loadPreview = useCallback(async () => {
    if (!eventId || !selectedListId) {
      setCategories([]);
      setSelectedCategoryIds([]);
      return;
    }
    const { data, error: rpcError } = await supabase.rpc(
      "preview_nearby_area_list_event_application",
      { p_event_id: eventId, p_area_list_id: selectedListId },
    );
    if (rpcError) {
      setCategories([]);
      setSelectedCategoryIds([]);
      setError("Could not preview Area List categories for this Event.");
      return;
    }
    const nextCategories = (data || []) as CategoryPreview[];
    setCategories(nextCategories);
    setSelectedCategoryIds(nextCategories.map((category) => category.category_id));
  }, [eventId, selectedListId]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  async function applyList() {
    if (!eventId || !selectedListId || selectedCategoryIds.length === 0) {
      setError("Choose an Area List and at least one represented category.");
      return;
    }
    setApplying(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("apply_nearby_area_list_to_event", {
      p_event_id: eventId,
      p_area_list_id: selectedListId,
      p_category_ids: selectedCategoryIds,
    });
    setApplying(false);
    if (rpcError) {
      setError("Could not apply this Area List. Existing Event curation was not changed.");
      return;
    }
    const result = Array.isArray(data) ? data[0] : data;
    const inserted = Number(result?.inserted_count || 0);
    const existing = Number(result?.already_associated_count || 0);
    setStatus(`${inserted} place${inserted === 1 ? "" : "s"} added; ${existing} already present.`);
    onApplied();
    await loadLists();
    await loadPreview();
  }

  const selectedList = lists.find((list) => list.id === selectedListId) ?? null;

  return (
    <PageSection variant="section">
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        <h2 className="app-section-title">Apply Reusable Area List</h2>
        <Alert tone="neutral">Applying is additive. Existing Event Nearby places and subsequent Event-specific curation remain independent.</Alert>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {status ? <Alert tone="success">{status}</Alert> : null}
        {!eventId ? <EmptyState message="Select an admin working event before applying an Area List." /> : null}
        {loading ? <LoadingState message="Loading Area Lists for this Event..." /> : null}
        {shouldShowNoListsEmptyState({ hasEventId: !!eventId, loading, hasError: !!error, listCount: lists.length }) ? <EmptyState message="No active Area Lists with eligible canonical places are available for this Event." /> : null}
        {eventId && lists.length > 0 ? (
          <>
            <Field label="Area List">
              {(controlProps) => (
                <Select {...controlProps} value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)} disabled={applying}>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>{list.name}{list.scope === "shared_public" ? " — Shared" : " — Tenant"}</option>
                  ))}
                </Select>
              )}
            </Field>
            {selectedList?.description ? <Alert tone="neutral">{selectedList.description}</Alert> : null}
            {selectedList && selectedList.uncategorized_member_count > 0 ? (
              <Alert tone="warning">{selectedList.uncategorized_member_count} active member{selectedList.uncategorized_member_count === 1 ? " is" : "s are"} uncategorized and cannot be applied until canonically categorized.</Alert>
            ) : null}
            <Field label="Categories to apply" required help="Only canonical categories represented by active, approved list members are available.">
              {(controlProps) => (
                <Select
                  {...controlProps}
                  multiple
                  value={selectedCategoryIds}
                  onChange={(event) => setSelectedCategoryIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
                  disabled={applying || categories.length === 0}
                  style={{ minHeight: 132 }}
                >
                  {categories.map((category) => (
                    <option key={category.category_id} value={category.category_id}>
                      {category.category_label} ({category.member_count})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <FormActions>
              <AppButton variant="primary" onClick={() => void applyList()} loading={applying} disabled={categories.length === 0 || selectedCategoryIds.length === 0}>
                Apply Area List to Event
              </AppButton>
            </FormActions>
          </>
        ) : null}
      </div>
    </PageSection>
  );
}
