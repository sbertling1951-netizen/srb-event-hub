// The public resolver is the sole source of slide identity/order. This is a
// transient projection for the two displays, never a second playback model.
export type PresentationFrame = {
  session_active: boolean;
  playback_state: "playing" | "paused" | null;
  state_version: number | null;
  sequence_number: number | null;
  item_count: number | null;
  current_content_type: "photo" | "blank" | null;
  current_content_ref_id: string | null;
  next_content_type: "photo" | "blank" | null;
  next_content_ref_id: string | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Whitelist fields when relaying a server response. Never transmit storage
// paths, signed URLs, credentials, or an arbitrary image source to the viewer.
export function presentationFrame(value: unknown): PresentationFrame | null {
  if (!value || typeof value !== "object") { return null; }
  const row = value as Record<string, unknown>;
  if (row.session_active === false) {
    return { session_active: false, playback_state: null, state_version: null,
      sequence_number: null, item_count: null, current_content_type: null,
      current_content_ref_id: null, next_content_type: null, next_content_ref_id: null };
  }
  const slot = (type: unknown, id: unknown) =>
    (type === "photo" && typeof id === "string" && uuid.test(id)) ||
    ((type === "blank" || type === null) && id === null);
  if (row.session_active !== true ||
      (row.playback_state !== "playing" && row.playback_state !== "paused") ||
      !Number.isSafeInteger(row.state_version) || (row.state_version as number) < 0 ||
      !Number.isSafeInteger(row.sequence_number) || (row.sequence_number as number) < 0 ||
      !Number.isSafeInteger(row.item_count) || (row.item_count as number) < 1 ||
      !slot(row.current_content_type, row.current_content_ref_id) ||
      !slot(row.next_content_type, row.next_content_ref_id)) { return null; }
  return {
    session_active: true,
    playback_state: row.playback_state,
    state_version: row.state_version as number,
    sequence_number: row.sequence_number as number,
    item_count: row.item_count as number,
    current_content_type: row.current_content_type as PresentationFrame["current_content_type"],
    current_content_ref_id: row.current_content_ref_id as string | null,
    next_content_type: row.next_content_type as PresentationFrame["next_content_type"],
    next_content_ref_id: row.next_content_ref_id as string | null,
  };
}
