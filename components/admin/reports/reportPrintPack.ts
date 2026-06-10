export type PrintPackRosterRow = {
  site: string;
  pilot: string;
  copilot: string;
  email: string;
  cityState: string;
};

type PrintPackType = "parking_ops" | "checkin_ops" | "hospitality_ops";

type PrintPackParams = {
  reportPackType: PrintPackType;
  sortedRosterRows: PrintPackRosterRow[];
  unassignedParkingRows: PrintPackRosterRow[];
  notArrivedRows: PrintPackRosterRow[];
  firstTimerRows: PrintPackRosterRow[];
  vendorStaffRows: PrintPackRosterRow[];
};

export function printReportPack({
  reportPackType,
  sortedRosterRows,
  unassignedParkingRows,
  notArrivedRows,
  firstTimerRows,
  vendorStaffRows,
}: PrintPackParams) {
  const titleMap = {
    parking_ops: "Parking Operations Pack",
    checkin_ops: "Check-In Pack",
    hospitality_ops: "Hospitality Pack",
  };

  const packTitle = titleMap[reportPackType];

  function makeSection(title: string, rows: PrintPackRosterRow[]) {
    return `
      <h2>${title}</h2>
      <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>Pilot</th>
            <th>Co-Pilot</th>
            <th>Email</th>
            <th>City/State</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length === 0
              ? `<tr><td colspan="5">No data</td></tr>`
              : rows
                  .map(
                    (r) => `
              <tr>
                <td>${r.site}</td>
                <td>${r.pilot}</td>
                <td>${r.copilot}</td>
                <td>${r.email}</td>
                <td>${r.cityState}</td>
              </tr>
            `,
                  )
                  .join("")
          }
        </tbody>
      </table>
    `;
  }

  let sections = "";

  if (reportPackType === "parking_ops") {
    sections += makeSection("Parking Assignments", sortedRosterRows);
    sections += makeSection("Needs Parking", unassignedParkingRows);
  }

  if (reportPackType === "checkin_ops") {
    sections += makeSection("Not Arrived", notArrivedRows);
    sections += makeSection("First Timers", firstTimerRows);
  }

  if (reportPackType === "hospitality_ops") {
    sections += makeSection("First Timers", firstTimerRows);
    sections += makeSection(
      "Vendors / Staff / Speakers / Hosts",
      vendorStaffRows,
    );
  }

  const html = `
    <html>
      <head>
        <title>${packTitle}</title>
        <style>
          body { font-family: Arial; margin: 20px; }
          h1 { margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #ccc; padding: 6px; font-size: 12px; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <h1>${packTitle}</h1>
        ${sections}
      </body>
    </html>
  `;

  const win = window.open("", "_blank");

  if (!win) {
    return;
  }

  win.document.write(html);
  win.document.close();
  win.print();
}
