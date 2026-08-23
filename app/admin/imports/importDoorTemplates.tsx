// Shared presentation for the Imports Service Center's per-type template
// download lists (Stage 5A doors: Attendee Roster, Agenda, Vendors). Pulled
// out of page.tsx so the Vendor door's own workflow component
// (VendorImportWorkflow.tsx) can reuse the same list/link rendering without
// importing from the page module itself (which would create a page <-> door
// component import cycle) and without hand-maintaining a second copy of the
// generated template file paths.
export type TemplateFile = { label: string; href: string };

export function TemplateDownloadList({ files }: { files: TemplateFile[] }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {files.map((file) => (
        <a key={file.href} href={file.href}>
          {file.label}
        </a>
      ))}
    </div>
  );
}

export const ATTENDEE_TEMPLATE_FILES: TemplateFile[] = [
  { label: "Download Sample CSV", href: "/templates/attendee-roster/attendee_roster_import_template_sample.csv" },
  { label: "Download Blank CSV", href: "/templates/attendee-roster/attendee_roster_import_template_blank.csv" },
  { label: "Download Sample XLSX", href: "/templates/attendee-roster/attendee_roster_import_template_sample.xlsx" },
  { label: "Download Blank XLSX", href: "/templates/attendee-roster/attendee_roster_import_template_blank.xlsx" },
  { label: "Instructions / notes", href: "/templates/attendee-roster/attendee_roster_import_template_notes.txt" },
];

export const AGENDA_TEMPLATE_FILES: TemplateFile[] = [
  { label: "Download Sample CSV", href: "/templates/agenda/agenda_import_template_sample_with_speaker.csv" },
  { label: "Download Blank CSV", href: "/templates/agenda/agenda_import_template_blank_with_speaker.csv" },
  { label: "Download Sample XLSX", href: "/templates/agenda/agenda_import_template_sample_with_speaker.xlsx" },
  { label: "Download Blank XLSX", href: "/templates/agenda/agenda_import_template_blank_with_speaker.xlsx" },
  { label: "Instructions / notes", href: "/templates/agenda/agenda_import_template_notes_with_speaker.txt" },
];

export const VENDOR_TEMPLATE_FILES: TemplateFile[] = [
  { label: "Download Sample CSV", href: "/templates/vendors/vendor_import_template_sample.csv" },
  { label: "Download Blank CSV", href: "/templates/vendors/vendor_import_template_blank.csv" },
  { label: "Download Sample XLSX", href: "/templates/vendors/vendor_import_template_sample.xlsx" },
  { label: "Download Blank XLSX", href: "/templates/vendors/vendor_import_template_blank.xlsx" },
  { label: "Instructions / notes", href: "/templates/vendors/vendor_import_template_notes.txt" },
];
