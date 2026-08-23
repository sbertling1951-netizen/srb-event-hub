export type RawImportRow = Record<string, unknown>;
export type ImportIssue = { code: string; message: string; severity: "error" | "warning" };
export type ActivityCandidate = { activity_name: string; raw_name: string; quantity: number; price: number | null; source_column_prefix: string };
export type AttendeeImportCandidate = {
  source_row_number: number;
  registration: { entry_id: string; pilot_first: string; pilot_last: string; nickname: string; email: string; membership_number: string; primary_phone: string; cell_phone: string; city: string; state: string; wants_to_volunteer: boolean; is_first_timer: boolean; share_with_attendees: boolean; special_events_raw: string; coach_manufacturer: string; coach_model: string };
  copilot: { first: string; last: string; nickname: string; email: string; cell_phone: string };
  capacity_evidence: { imported_capacity: number | null; structured_participant_minimum: number };
  activities: ActivityCandidate[];
  reference_only: { additional_attendees: string };
};
export type AttendeeImportInterpretation = { source_payload: RawImportRow; candidate: AttendeeImportCandidate; fingerprint: Promise<string>; validation_state: "valid" | "validation_failed" | "needs_review"; issues: ImportIssue[]; identifier_evidence: { entry_id: string; email: string } };

// Stage 5A: the current preferred EpicentraX vocabulary advertised on
// downloadable templates (lib/importTemplateContract.ts), one entry per
// FIELD_ALIASES key. Every value here must already be case-insensitively
// accepted by FIELD_ALIASES below -- see attendeeImportContract.test.ts's
// "every preferred heading is an accepted alias" proof. This is
// documentation/template metadata only; it changes no parsing,
// normalization, or validation behavior.
export const PREFERRED_ATTENDEE_HEADINGS = {
  entry_id: "Entry ID", email: "Email Address", pilot_first: "Pilot First Name", pilot_last: "Pilot Last Name", nickname: "Nickname for Badge",
  copilot_first: "Co-Pilot First Name", copilot_last: "Co-Pilot Last Name", copilot_nickname: "Co-Pilot Nickname", copilot_email: "Co-Pilot Email", copilot_cell_phone: "Co-Pilot Cell Phone",
  additional_attendees: "Additional Attendees", participant_capacity: "Participant Capacity", membership_number: "Membership Number",
  primary_phone: "Primary Phone", cell_phone: "Cell Phone", city: "City", state: "State",
  coach_manufacturer: "Coach Manufacturer", coach_model: "Coach Model", special_events_raw: "Special Events",
  share_with_attendees: "Share Email With Attendees", wants_to_volunteer: "Volunteer", is_first_timer: "First Timer",
} as const;
export const FIELD_ALIASES = {
  entry_id: ["Entry Id", "Entry ID", "EntryId", "Order Id", "Order ID"], email: ["Email Address", "Email", "E-mail", "Email address"],
  pilot_first: ["Pilot Name (First)", "Pilot First Name", "Pilot First", "First Name"], pilot_last: ["Pilot Name (Last)", "Pilot Last Name", "Pilot Last", "Last Name"],
  nickname: ["Nickname for Badge", "Pilot Nickname for Badge", "Pilot Badge Nickname", "Badge Nickname"],
  copilot_first: ["Co-Pilot Name (First)", "Copilot Name (First)", "Co-Pilot First Name", "Copilot First Name", "Co-Pilot First", "Copilot First"],
  copilot_last: ["Co-Pilot Name (Last)", "Copilot Name (Last)", "Co-Pilot Last Name", "Copilot Last Name", "Co-Pilot Last", "Copilot Last"],
  copilot_nickname: ["Nickname for Badge.1", "Co-Pilot Nickname", "Co-Pilot Nickname for Badge", "Copilot Nickname for Badge", "Co-Pilot Badge Nickname", "Copilot Badge Nickname"],
  copilot_email: ["Co-Pilot Email", "Copilot Email", "Co-Pilot E-mail", "Copilot E-mail"], copilot_cell_phone: ["Co-Pilot Cell Phone", "Copilot Cell Phone", "Co-Pilot Mobile", "Copilot Mobile"],
  additional_attendees: ["Additional attendees, if so give name(s) and age(s)", "Additional Attendees", "Additional Guests", "Additional Household Members"],
  participant_capacity: ["Party Size", "Number of Attendees", "Number of Participants", "Participant Capacity", "Paid Participant Capacity", "Capacity"], membership_number: ["FCOC Membership Number", "Membership Number", "Member Number"],
  primary_phone: ["Primary Phone #", "Primary Phone", "Phone", "Phone Number"], cell_phone: ["Cell Phone #", "Cell Phone", "Mobile Phone", "Mobile"], city: ["Address (City)", "City", "Mailing City"], state: ["Address (State / Province)", "State", "State / Province", "Province"],
  coach_manufacturer: ["Coach Manufacturer", "Coach Make", "Motorhome Manufacturer", "RV Manufacturer"], coach_model: ["Coach Model", "Model", "RV Model"], special_events_raw: ["Special Events", "Special Event Selections", "Activities"],
  share_with_attendees: ["Ok to share your email with other attendees?", "OK to share your email with other attendees?", "Share email with attendees", "Share with attendees"], wants_to_volunteer: ["Would you like to volunteer to help with the event?", "Volunteer to help with event", "Would you like to volunteer?", "Volunteer"], is_first_timer: ["First time at an FCOC event?", "First Timer", "First time attendee", "Is First Timer"],
} as const;
const key = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
const text = (v: unknown) => v == null ? "" : String(v).trim();
const integer = (v: unknown) => { const s = text(v); if (!s || !/^-?\d+(?:\.\d+)?$/.test(s)) return null; return Math.round(Number(s)); };
const money = (v: unknown) => { const n = Number(text(v).replace(/[$,]/g, "")); return text(v) && Number.isFinite(n) ? n : null; };
export const normalizePhone = (v: unknown) => { const raw = text(v), d = raw.replace(/\D+/g, ""); return d.length === 10 ? `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` : d.length === 11 && d[0] === "1" ? `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}` : raw; };
function values(row: RawImportRow, aliases: readonly string[]) { const matches = Object.entries(row).filter(([h]) => aliases.some(a => key(a) === key(h))).map(([,v]) => text(v)); return [...new Set(matches.filter(Boolean))]; }
function field(row: RawImportRow, name: keyof typeof FIELD_ALIASES, issues: ImportIssue[]) { const found = values(row, FIELD_ALIASES[name]); if (found.length > 1) issues.push({ code: "conflicting_aliases", message: `Conflicting values for ${name}`, severity: "error" }); return found[0] || ""; }
export function detectActivityGroups(headers: string[]) { const groups = new Map<string, { prefix: string; nameCol?: string; priceCol?: string; qtyCol?: string }>(); for (const h of headers) { const m = key(h).match(/^(.*)\s+\((Name|Price|Quantity)\)$/i); if (!m) continue; const prefix=m[1].trim(); if (["product name","credit card","pilot name","co-pilot name"].some(x=>prefix.startsWith(x))) continue; const g=groups.get(prefix)||{prefix}; if(m[2].toLowerCase()==="name")g.nameCol=h; else if(m[2].toLowerCase()==="price")g.priceCol=h; else g.qtyCol=h; groups.set(prefix,g); } return [...groups.values()].filter((g): g is Required<typeof g> => !!g.nameCol&&!!g.priceCol&&!!g.qtyCol); }
function bool(v: unknown, label: string, issues: ImportIssue[]) { const s=key(text(v)); if (!s) return false; if (["yes","y","true","1"].includes(s)) return true; if (["no","n","false","0"].includes(s)) return false; issues.push({code:"malformed_boolean",message:`Malformed ${label}`,severity:"error"}); return false; }
function stable(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(",")}}`; return JSON.stringify(value); }
export async function fingerprintAttendeeImportCandidate(candidate: AttendeeImportCandidate) { const bytes=new TextEncoder().encode(stable(candidate)); const hash=await crypto.subtle.digest("SHA-256",bytes); return `sha256:${[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,"0")).join("")}`; }
export function interpretAttendeeImportRow(source_payload: RawImportRow, source_row_number: number, headers = Object.keys(source_payload)): AttendeeImportInterpretation {
  const issues: ImportIssue[]=[]; const f=(n:keyof typeof FIELD_ALIASES)=>field(source_payload,n,issues); const capRaw=f("participant_capacity"), cap=integer(capRaw);
  const pilot_first=f("pilot_first"), pilot_last=f("pilot_last"), email=f("email").toLowerCase(), primary=normalizePhone(f("primary_phone")), cell=normalizePhone(f("cell_phone"));
  const copilotFirst=f("copilot_first"); const candidate: AttendeeImportCandidate={ source_row_number, registration:{entry_id:f("entry_id"),pilot_first,pilot_last,nickname:f("nickname"),email,membership_number:f("membership_number"),primary_phone:primary,cell_phone:cell,city:f("city"),state:f("state"),wants_to_volunteer:bool(f("wants_to_volunteer"),"volunteer flag",issues),is_first_timer:bool(f("is_first_timer"),"first-timer flag",issues),share_with_attendees:bool(f("share_with_attendees"),"sharing flag",issues),special_events_raw:f("special_events_raw"),coach_manufacturer:f("coach_manufacturer"),coach_model:f("coach_model")},copilot:{first:copilotFirst,last:f("copilot_last"),nickname:f("copilot_nickname"),email:f("copilot_email").toLowerCase(),cell_phone:normalizePhone(f("copilot_cell_phone"))},capacity_evidence:{imported_capacity:cap,structured_participant_minimum:(pilot_first||pilot_last?1:0)+(copilotFirst?1:0)},activities:[],reference_only:{additional_attendees:f("additional_attendees")}};
  if (!candidate.registration.entry_id) issues.push({code:"missing_entry_id",message:"Missing Entry ID",severity:"error"}); if (!email) issues.push({code:"missing_email",message:"Missing email",severity:"error"}); else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push({code:"malformed_email",message:"Malformed email",severity:"error"}); if (!pilot_first&&!pilot_last) issues.push({code:"missing_pilot_name",message:"Missing Pilot name evidence",severity:"error"}); for (const p of [primary,cell,candidate.copilot.cell_phone]) if (p&&p.replace(/\D/g,"").length!==10) issues.push({code:"malformed_phone",message:"Malformed phone",severity:"error"}); if (capRaw && (cap===null||cap<=0)) issues.push({code:"invalid_capacity",message:"Participant Capacity must be positive",severity:"error"});
  for (const g of detectActivityGroups(headers)) { const q=integer(source_payload[g.qtyCol]); if (q===null&&text(source_payload[g.qtyCol])) issues.push({code:"malformed_activity_quantity",message:`Malformed quantity for ${g.prefix}`,severity:"error"}); else if (q!==null&&q<0) issues.push({code:"negative_activity_quantity",message:`Negative quantity for ${g.prefix}`,severity:"error"}); else if (q&&q>0) candidate.activities.push({activity_name:g.prefix,raw_name:text(source_payload[g.nameCol])||g.prefix,quantity:q,price:money(source_payload[g.priceCol]),source_column_prefix:g.prefix}); }
  return {source_payload,candidate,fingerprint:fingerprintAttendeeImportCandidate(candidate),validation_state:issues.some(i=>i.severity==="error")?"validation_failed":"valid",issues,identifier_evidence:{entry_id:candidate.registration.entry_id,email}};
}
export function classifyFileAmbiguities(rows: AttendeeImportInterpretation[]) { const seen=new Map<string,AttendeeImportInterpretation[]>(); for(const r of rows) for(const [kind,v] of Object.entries(r.identifier_evidence)) if(v) { const k=`${kind}:${v}`; seen.set(k,[...(seen.get(k)||[]),r]); } return [...seen.entries()].filter(([,v])=>v.length>1).map(([key,rows])=>({key,row_numbers:rows.map(r=>r.candidate.source_row_number),state:"needs_review" as const})); }
export function classifyExternalDedupeEvidence(email_target_id: string | null, entry_id_target_id: string | null) { return email_target_id&&entry_id_target_id&&email_target_id!==entry_id_target_id ? "needs_review" as const : "unresolved" as const; }
