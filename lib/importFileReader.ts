import * as XLSX from "xlsx";
import { mapImportRow, type ParsedImportRow } from "@/lib/importMapping";

export async function readImportFile(file: File): Promise<ParsedImportRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (!rows || rows.length < 2) {
    return [];
  }

  const dataRows = rows.slice(1);

  return dataRows
    .filter(
      (row) =>
        Array.isArray(row) &&
        row.some((cell) => String(cell ?? "").trim() !== ""),
    )
    .map((row) => mapImportRow(row));
}
