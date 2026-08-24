// Stage 5A shared template-definition structure (one source of truth per
// import type). Each entry describes one column a downloadable template
// advertises: its preferred heading, whether it is required, its expected
// format, human instructions, and a sample value. Parser authority stays
// domain-specific (Stage 2's lib/attendeeImportContract.ts for Attendee
// Roster, lib/agendaImportContract.ts for Agenda);
// this module never re-implements or overrides that authority. It exists
// so a downloadable template is generated from -- or, where a template is
// already a maintained static asset, tested against -- the same canonical
// field definitions the importer actually accepts, per
// docs/architecture/EPICENTRAX_GOVERNED_IMPORT_STAGING_ARCHITECTURE.md's
// Shared Service Center / template system section.
import {
  FIELD_ALIASES as ATTENDEE_FIELD_ALIASES,
  PREFERRED_ATTENDEE_HEADINGS,
} from "@/lib/attendeeImportContract";
import type { ImportType } from "@/lib/importTypeRouting";
import {
  PREFERRED_VENDOR_HEADINGS,
  VENDOR_FIELD_ALIASES,
} from "@/lib/vendorImportContract";

export type ImportFieldFormat =
  | "text"
  | "email"
  | "phone"
  | "url"
  | "date"
  | "time"
  | "integer"
  | "boolean_yes_no"
  | "hex_color"
  | "enum";

export type ImportFieldContractEntry = {
  key: string;
  preferredHeading: string;
  /** Every heading this field's importer actually accepts, preferred heading included. */
  aliases: string[];
  required: boolean;
  format: ImportFieldFormat;
  instructions: string;
  sample: string;
};

export type ImportTemplateContract = {
  importType: ImportType;
  label: string;
  fields: ImportFieldContractEntry[];
};

// ---- Attendee Roster (Stage 2 is the sole source of truth) --------------

const ATTENDEE_FIELD_META: Record<
  keyof typeof ATTENDEE_FIELD_ALIASES,
  { required: boolean; format: ImportFieldFormat; instructions: string; sample: string }
> = {
  entry_id: { required: true, format: "text", instructions: "The unique registration identifier from your registration platform. Required -- used to match this row to an existing attendee on re-import.", sample: "REG-10234" },
  email: { required: true, format: "email", instructions: "The Pilot's email address. Required.", sample: "ada.pilot@example.com" },
  pilot_first: { required: false, format: "text", instructions: "Pilot first name. At least one of Pilot First Name / Pilot Last Name is required.", sample: "Ada" },
  pilot_last: { required: false, format: "text", instructions: "Pilot last name. At least one of Pilot First Name / Pilot Last Name is required.", sample: "Lovelace" },
  nickname: { required: false, format: "text", instructions: "Name shown on the Pilot's badge, if different from their first name.", sample: "Ace" },
  copilot_first: { required: false, format: "text", instructions: "Co-Pilot first name, if there is a Co-Pilot on this registration.", sample: "Grace" },
  copilot_last: { required: false, format: "text", instructions: "Co-Pilot last name.", sample: "Hopper" },
  copilot_nickname: { required: false, format: "text", instructions: "Name shown on the Co-Pilot's badge, if different from their first name.", sample: "Gigi" },
  copilot_email: { required: false, format: "email", instructions: "Co-Pilot email address (Policy 1: committed only to the attendee's Co-Pilot fields, never a separate household member or Person record).", sample: "grace.copilot@example.com" },
  copilot_cell_phone: { required: false, format: "phone", instructions: "Co-Pilot cell phone number.", sample: "555-201-0022" },
  additional_attendees: { required: false, format: "text", instructions: "Reference-only free text (e.g. names/ages of additional household members riding along). Never creates a Person, participation, or household-member record -- for context only.", sample: "Pat (age 9), Sam (age 7)" },
  participant_capacity: { required: false, format: "integer", instructions: "Total paid participant capacity for this registration, if your registration platform tracks it explicitly. Leave blank to let the import evidence the minimum from Pilot/Co-Pilot names.", sample: "2" },
  membership_number: { required: false, format: "text", instructions: "Membership number, if the Pilot is a member.", sample: "F102345" },
  primary_phone: { required: false, format: "phone", instructions: "Pilot's primary phone number.", sample: "555-201-0011" },
  cell_phone: { required: false, format: "phone", instructions: "Pilot's cell phone number.", sample: "555-201-0012" },
  city: { required: false, format: "text", instructions: "Pilot's mailing city.", sample: "St. George" },
  state: { required: false, format: "text", instructions: "Pilot's mailing state/province.", sample: "UT" },
  coach_manufacturer: { required: false, format: "text", instructions: "Coach/motorhome manufacturer.", sample: "Newmar" },
  coach_model: { required: false, format: "text", instructions: "Coach/motorhome model.", sample: "Dutch Star" },
  special_events_raw: { required: false, format: "text", instructions: "Free-text notes on special-event selections not captured by a dedicated activity column.", sample: "Welcome Dinner" },
  share_with_attendees: { required: false, format: "boolean_yes_no", instructions: "Whether the Pilot agreed to share their email with other attendees. Yes/Y/True/1 is Yes; anything else (including blank) is No.", sample: "Yes" },
  wants_to_volunteer: { required: false, format: "boolean_yes_no", instructions: "Whether the Pilot wants to volunteer. Yes/Y/True/1 is Yes; anything else (including blank) is No.", sample: "No" },
  is_first_timer: { required: false, format: "boolean_yes_no", instructions: "Whether this is the Pilot's first time at an FCOC event. Yes/Y/True/1 is Yes; anything else (including blank) is No.", sample: "No" },
};

// Column order mirrors the approved field list, not object insertion order.
const ATTENDEE_FIELD_ORDER: (keyof typeof ATTENDEE_FIELD_ALIASES)[] = [
  "entry_id", "pilot_first", "pilot_last", "nickname", "email", "membership_number",
  "primary_phone", "cell_phone", "city", "state",
  "copilot_first", "copilot_last", "copilot_nickname", "copilot_email", "copilot_cell_phone",
  "coach_manufacturer", "coach_model", "participant_capacity",
  "wants_to_volunteer", "is_first_timer", "share_with_attendees", "special_events_raw", "additional_attendees",
];

export const ATTENDEE_IMPORT_TEMPLATE_CONTRACT: ImportTemplateContract = {
  importType: "attendee-roster",
  label: "Attendee Roster",
  fields: ATTENDEE_FIELD_ORDER.map((key) => ({
    key,
    preferredHeading: PREFERRED_ATTENDEE_HEADINGS[key],
    aliases: [...ATTENDEE_FIELD_ALIASES[key]],
    ...ATTENDEE_FIELD_META[key],
  })),
};

// ---- Agenda (pure row contract; see lib/agendaImportContract.ts) --------
//
// This remains the sole Agenda template/alias vocabulary. The pure Agenda
// contract consumes these aliases; the page performs file I/O and submits
// the already-normalized batch through its existing governed RPC.

export const AGENDA_IMPORT_TEMPLATE_CONTRACT: ImportTemplateContract = {
  importType: "agenda",
  label: "Agenda",
  fields: [
    { key: "title", preferredHeading: "Title", aliases: ["Title", "title"], required: true, format: "text", instructions: "The agenda item's title. Required.", sample: "Welcome Breakfast" },
    { key: "description", preferredHeading: "Description", aliases: ["Description", "description"], required: false, format: "text", instructions: "Optional longer description shown on the item's detail view.", sample: "Coffee, pastries, and a welcome from the FCOC board." },
    { key: "location", preferredHeading: "Location", aliases: ["Location", "location", "Room", "Venue"], required: false, format: "text", instructions: "Where the item takes place.", sample: "Main Pavilion" },
    { key: "speaker", preferredHeading: "Speaker", aliases: ["Speaker", "speaker", "Presenter", "Host"], required: false, format: "text", instructions: "Optional presenter/host.", sample: "Event Staff" },
    { key: "agenda_date", preferredHeading: "Agenda Date", aliases: ["Agenda Date", "AgendaDate", "Date", "date", "agenda_date", "AGENDA DATE"], required: true, format: "date", instructions: "Required. Enter an ordinary US date such as 11/4/26 or 11/04/2026. M/D without a year uses the selected Event's scheduled date context. Canonical YYYY-MM-DD is also accepted. Impossible or ambiguous dates are rejected.", sample: "2026-09-12" },
    { key: "start_time", preferredHeading: "Start Time", aliases: ["Start Time", "start_time", "Start", "start"], required: true, format: "time", instructions: "Required. Enter a clock time such as 9 AM, 1:00 PM, 900, 1300, or 24-hour HH:MM. EpicentraX normalizes accepted values to HH:MM.", sample: "08:00" },
    { key: "end_time", preferredHeading: "End Time", aliases: ["End Time", "end_time", "End", "end"], required: false, format: "time", instructions: "Optional. Accepts the same clock forms as Start Time and normalizes them to HH:MM.", sample: "09:00" },
    { key: "category", preferredHeading: "Category", aliases: ["Category", "category"], required: false, format: "text", instructions: "Optional category, used for the item's default color if Color is blank.", sample: "Meals" },
    { key: "color", preferredHeading: "Color", aliases: ["Color", "color"], required: false, format: "hex_color", instructions: "Optional hex color like #DBEAFE. If blank, a color is derived from Category.", sample: "#DBEAFE" },
    {
      key: "is_published", preferredHeading: "Published", aliases: ["Published", "published", "Is Published", "is_published"], required: false, format: "boolean_yes_no",
      instructions: "Yes/Y/True/1 publishes the item immediately. Blank, or any other value, imports the item as NOT published (draft) -- there is no separate default; blank is treated identically to No.",
      sample: "Yes",
    },
    { key: "sort_order", preferredHeading: "Sort Order", aliases: ["Sort Order", "sort_order"], required: false, format: "integer", instructions: "Optional display order (e.g. 10, 20, 30). If blank, items are ordered by file row order.", sample: "10" },
  ],
};

// ---- Vendors (lib/vendorImportContract.ts is the sole source of truth) --
//
// Stage 5B Vendor import audit: the Stage 5B.1 normalization contract
// (lib/vendorImportContract.ts, VENDOR_FIELD_ALIASES/PREFERRED_VENDOR_HEADINGS)
// is the real, executable parser's own field/alias vocabulary -- already
// governed identity input to commit_vendor_import_run_row (Stage 5B.2).
// This template previously hand-duplicated that same field list instead of
// importing it, which is exactly the "decorative template schema that can
// drift from accepted input" risk a template contract must not create.
// Reusing it here, the same way ATTENDEE_IMPORT_TEMPLATE_CONTRACT reuses
// lib/attendeeImportContract.ts's FIELD_ALIASES, makes drift structurally
// impossible: preferredHeading/aliases/key below can never diverge from
// what the real parser accepts, because they are the same values.
//
// format/instructions/sample below are template-only presentation
// metadata the parser itself has no opinion on (mirroring
// ATTENDEE_FIELD_META's identical role for the Attendee contract).

const VENDOR_FIELD_META: Record<
  keyof typeof VENDOR_FIELD_ALIASES,
  { required: boolean; format: ImportFieldFormat; instructions: string; sample: string }
> = {
  business_name: { required: true, format: "text", instructions: "The vendor's business name. Required. This is the sole identity key the governed import matches against the canonical Vendor directory.", sample: "Sunrise Coach Detailing" },
  contact_name: { required: false, format: "text", instructions: "The vendor's primary contact person.", sample: "Jordan Rivera" },
  email: { required: false, format: "email", instructions: "Vendor contact email.", sample: "jordan@sunrisedetailing.example.com" },
  phone: { required: false, format: "phone", instructions: "Vendor contact phone.", sample: "555-301-0044" },
  website: { required: false, format: "url", instructions: "Vendor website, if any.", sample: "https://sunrisedetailing.example.com" },
  business_description: { required: false, format: "text", instructions: "Short description shown on the vendor's public listing.", sample: "Mobile coach washing and detailing at your site." },
  // Enum values are the real <Select> options on /admin/vendors/page.tsx's
  // own Preferred Contact Method field, not a guessed vocabulary.
  preferred_contact_method: { required: false, format: "enum", instructions: "One of: email, phone, text, in_app.", sample: "email" },
  admit: { required: false, format: "boolean_yes_no", instructions: "Yes admits the matched Vendor to this Event through the governed commit (commit_vendor_import_run_row -> admit_vendor_for_event). Blank/No issues no admission instruction -- it never revokes an existing admission.", sample: "Yes" },
  is_featured: { required: false, format: "boolean_yes_no", instructions: "Per-event display flag. Maps to event_vendors.is_featured.", sample: "No" },
  is_visible_to_members: { required: false, format: "boolean_yes_no", instructions: "Per-event display flag. Maps to event_vendors.is_visible_to_members.", sample: "Yes" },
  action_type: { required: false, format: "enum", instructions: "One of: service_request, external_signup, info_only. Maps to event_vendors.action_type.", sample: "service_request" },
  signup_url: { required: false, format: "url", instructions: "Required only when Action Type is external_signup. Maps to event_vendors.signup_url.", sample: "https://sunrisedetailing.example.com/book" },
  booth_location: { required: false, format: "text", instructions: "Per-event booth/site location. Maps to the governed event_vendors.booth_location field.", sample: "Row C, Site 14" },
  event_note: { required: false, format: "text", instructions: "Per-event admin note. Maps to event_vendors.event_note.", sample: "Requested power hookup near booth." },
  display_order: { required: false, format: "integer", instructions: "Per-event display order. Maps to event_vendors.display_order (default 100 if blank).", sample: "100" },
  show_on_member_dashboard: { required: false, format: "boolean_yes_no", instructions: "Per-event dashboard-display flag. Maps to the governed event_vendors.show_on_member_dashboard field. Blank preserves the existing Event-Vendor value.", sample: "Yes" },
  allow_service_requests: { required: false, format: "boolean_yes_no", instructions: "Per-event service-request flag. Maps to the governed event_vendors.allow_service_requests field. Blank preserves the existing Event-Vendor value.", sample: "No" },
};

// Column order mirrors the approved field list, not object insertion order.
const VENDOR_FIELD_ORDER: (keyof typeof VENDOR_FIELD_ALIASES)[] = [
  "business_name", "contact_name", "email", "phone", "website", "business_description",
  "preferred_contact_method", "admit", "is_featured", "is_visible_to_members", "action_type",
  "signup_url", "booth_location", "event_note", "display_order", "show_on_member_dashboard",
  "allow_service_requests",
];

export const VENDOR_IMPORT_TEMPLATE_CONTRACT: ImportTemplateContract = {
  importType: "vendors",
  label: "Vendors",
  fields: VENDOR_FIELD_ORDER.map((key) => ({
    key,
    preferredHeading: PREFERRED_VENDOR_HEADINGS[key],
    aliases: [...VENDOR_FIELD_ALIASES[key]],
    ...VENDOR_FIELD_META[key],
  })),
};

export const IMPORT_TEMPLATE_CONTRACTS: Record<ImportType, ImportTemplateContract> = {
  "attendee-roster": ATTENDEE_IMPORT_TEMPLATE_CONTRACT,
  agenda: AGENDA_IMPORT_TEMPLATE_CONTRACT,
  vendors: VENDOR_IMPORT_TEMPLATE_CONTRACT,
};
