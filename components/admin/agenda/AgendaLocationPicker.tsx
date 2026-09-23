"use client";

// Agenda-specific searchable Location picker. The operator sees the locations
// ALREADY used by the current Event (and, during an import correction, the
// other rows of the same import) and can either reuse one or explicitly add a
// new name. It never persists anything and never owns a location registry --
// `agenda_items.location` remains the sole source of truth. Selecting or
// typing only reports the chosen string back through `onChange`; the caller's
// own form state (and its draft-recovery) is unaffected, so choosing a
// location never saves an Agenda item or discards unfinished editor text.
//
// Comparison rules (trim + collapse whitespace + case-fold) come from
// lib/agendaLocations.ts, shared with the member Agenda columns and the import
// advisories so all three surfaces agree on what "the same location" means:
// capitalization/spacing variants are reused, and genuinely different names
// are never silently merged -- similar existing names are only offered.

import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import type { FieldControlProps } from "@/components/ui/Field";
import {
  type AgendaLocationOption,
  collectAgendaLocations,
  findMatchingLocation,
  findSimilarLocations,
  locationComparisonKey,
  normalizeLocationDisplay,
} from "@/lib/agendaLocations";

/** Existing options whose label or key contains the typed query (case/space
 * insensitive). An empty query lists every existing location. */
export function filterLocationOptions(
  options: readonly AgendaLocationOption[],
  query: string,
): AgendaLocationOption[] {
  const key = locationComparisonKey(query);
  if (!key) {
    return [...options];
  }
  return options.filter(
    (option) => option.key.includes(key) || option.label.toLowerCase().includes(key),
  );
}

export type AgendaLocationPickerEntry =
  | { type: "existing"; option: AgendaLocationOption }
  | { type: "add"; display: string };

export type AgendaLocationPickerModel = {
  /** Normalized display form of the current typed value. */
  query: string;
  /** An existing option whose key equals the typed value's key, if any. */
  exactMatch: AgendaLocationOption | null;
  /** Existing options matching the query, for the listbox. */
  filtered: AgendaLocationOption[];
  /** True when the typed value is a genuinely new name (no exact key match). */
  canAddNew: boolean;
  /** Similar existing names offered as possible-typo suggestions. */
  suggestions: AgendaLocationOption[];
  /** Flat listbox entries: existing matches, then the optional Add row. */
  entries: AgendaLocationPickerEntry[];
};

/**
 * Pure decision model behind the picker. Kept separate from rendering so the
 * reuse/add/suggest logic is directly unit-testable.
 */
export function buildLocationPickerModel(
  value: string,
  options: readonly AgendaLocationOption[],
): AgendaLocationPickerModel {
  const query = normalizeLocationDisplay(value);
  const exactMatch = findMatchingLocation(value, options);
  const filtered = filterLocationOptions(options, query);
  const canAddNew = query !== "" && exactMatch === null;
  const suggestions = canAddNew ? findSimilarLocations(value, options) : [];
  const entries: AgendaLocationPickerEntry[] = filtered.map((option) => ({
    type: "existing" as const,
    option,
  }));
  if (canAddNew) {
    entries.push({ type: "add", display: query });
  }
  return { query, exactMatch, filtered, canAddNew, suggestions, entries };
}

/**
 * How a location value reached the caller:
 * - "input": raw typing (never counts as a deliberate choice on its own);
 * - "existing": an existing option was selected (or a variant blur-snapped);
 * - "suggestion": a "did you mean" typo suggestion (an existing name) was taken;
 * - "add": the operator explicitly chose to add the typed new name.
 * The SAVE path uses this to require a deliberate choice for a new name.
 */
export type LocationChangeSource = "input" | "existing" | "suggestion" | "add";

export type AgendaLocationPickerProps = {
  value: string;
  onChange: (next: string, source: LocationChangeSource) => void;
  /** Existing locations to offer (already deduped via collectAgendaLocations,
   * or raw strings which are deduped here). */
  options: readonly AgendaLocationOption[];
  controlProps?: Partial<FieldControlProps>;
  placeholder?: string;
  disabled?: boolean;
};

/** Convenience for callers holding raw strings rather than deduped options. */
export function toLocationOptions(
  values: Iterable<string | null | undefined>,
): AgendaLocationOption[] {
  return collectAgendaLocations(values);
}

export function AgendaLocationPicker({
  value,
  onChange,
  options,
  controlProps,
  placeholder = "Search or add a location",
  disabled = false,
}: AgendaLocationPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const optionBaseId = useId();

  const model = useMemo(
    () => buildLocationPickerModel(value, options),
    [value, options],
  );
  const { entries, suggestions } = model;

  // Keep the active option within the current entry list.
  useEffect(() => {
    setActiveIndex((index) => (index >= entries.length ? entries.length - 1 : index));
  }, [entries.length]);

  // Close the dropdown when focus leaves the whole control.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent | MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function commit(next: string, source: LocationChangeSource) {
    onChange(next, source);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function commitEntry(entry: AgendaLocationPickerEntry) {
    if (entry.type === "existing") {
      commit(entry.option.label, "existing");
    } else {
      commit(entry.display, "add");
    }
  }

  function handleBlur() {
    // Reuse an existing spelling rather than leave a capitalization/spacing
    // variant behind (which would create a duplicate member column). Only an
    // exact-key match is adopted; a different name is never touched.
    if (model.exactMatch && model.exactMatch.label !== value) {
      onChange(model.exactMatch.label, "existing");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
      }
      setActiveIndex((index) => Math.min(index + 1, entries.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < entries.length) {
        // Selecting from the open list must not also submit an enclosing form
        // (e.g. the Edit Row dialog's Enter-to-save).
        event.preventDefault();
        event.stopPropagation();
        commitEntry(entries[activeIndex]);
      }
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  const activeOptionId =
    open && activeIndex >= 0 && activeIndex < entries.length
      ? `${optionBaseId}-${activeIndex}`
      : undefined;

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: 0 }}>
      {suggestions.length > 0 ? (
        // Rendered ABOVE the input so it stays visible and clickable even
        // while the (absolutely positioned) options list is open below.
        <div
          className="app-field-help"
          role="note"
          style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 4 }}
        >
          <span>
            Similar existing location{suggestions.length === 1 ? "" : "s"} — did you mean:
          </span>
          {suggestions.map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(option.label, "suggestion")}
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                color: "#1d4ed8",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          ))}
          <span>or keep “{model.query}”.</span>
        </div>
      ) : null}
      <input
        {...controlProps}
        ref={inputRef}
        className="app-control"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled ?? controlProps?.disabled}
        onChange={(event) => {
          onChange(event.target.value, "input");
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />

      {open && entries.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Existing event locations"
          style={{
            position: "absolute",
            top: "calc(100% + 2px)",
            left: 0,
            right: 0,
            zIndex: 30,
            margin: 0,
            padding: 4,
            listStyle: "none",
            maxHeight: 240,
            overflowY: "auto",
            background: "#ffffff",
            border: "1px solid #d1d5db",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(15,23,42,0.14)",
          }}
        >
          {entries.map((entry, index) => {
            const isActive = index === activeIndex;
            const optionId = `${optionBaseId}-${index}`;
            const label =
              entry.type === "existing"
                ? entry.option.label
                : `Add new location: “${entry.display}”`;
            return (
              <li
                key={optionId}
                id={optionId}
                role="option"
                aria-selected={isActive}
                // Keep focus on the input so blur-snap and mobile taps do not
                // race the click that selects this option.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitEntry(entry)}
                onMouseEnter={() => setActiveIndex(index)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: entry.type === "add" ? 700 : 500,
                  color: entry.type === "add" ? "#1d4ed8" : "#111827",
                  background: isActive ? "#eff6ff" : "transparent",
                  overflowWrap: "anywhere",
                }}
              >
                {label}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
