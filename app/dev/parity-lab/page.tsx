"use client";

import {
  containDivergencePositioner,
  currentPositioner,
  edgeCaseMarkers,
  edgeCaseViewports,
  runParity,
} from "@/lib/map/parity";

export default function ParityLabPage() {
  const green = runParity(
    currentPositioner,
    currentPositioner,
    edgeCaseMarkers,
    edgeCaseViewports,
    0
  );

  const red = runParity(
    currentPositioner,
    containDivergencePositioner,
    edgeCaseMarkers,
    edgeCaseViewports,
    0
  );

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Map Parity Lab</h1>

      <section>
        <h2 style={{ color: green.allPass ? "green" : "red" }}>
          Current vs MapCanvas: {green.allPass ? "PASS" : "FAIL"}
        </h2>
        <p>
          Checks: {green.rows.length} | Max delta: {green.maxDelta} | Threshold:{" "}
          {green.threshold}
        </p>
      </section>

      <section>
        <h2 style={{ color: red.allPass ? "green" : "red" }}>
          Negative Control: {red.allPass ? "PASS" : "FAIL"}
        </h2>
        <p>
          Checks: {red.rows.length} | Max delta: {red.maxDelta} | Threshold:{" "}
          {red.threshold}
        </p>
      </section>

      <h2>Delta Table</h2>

      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {[
              "Scenario",
              "Site",
              "Old X",
              "Old Y",
              "New X",
              "New Y",
              "Delta X",
              "Delta Y",
              "Pass",
            ].map((h) => (
              <th key={h} style={{ border: "1px solid #ccc", padding: 6 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {green.rows.map((r, i) => (
            <tr key={`${r.scenario}-${r.site}-${i}`}>
              <td style={{ border: "1px solid #ccc", padding: 6 }}>{r.scenario}</td>
              <td style={{ border: "1px solid #ccc", padding: 6 }}>{r.site}</td>
              <td style={{ border: "1px solid #ccc", padding: 6 }}>{r.oldX}</td>
              <td style={{ border: "1px solid #ccc", padding: 6 }}>{r.oldY}</td>
              <td style={{ border: "1px solid #ccc", padding: 6 }}>{r.newX}</td>
              <td style={{ border: "1px solid #ccc", padding: 6 }}>{r.newY}</td>
              <td style={{ border: "1px solid #ccc", padding: 6 }}>{r.deltaX}</td>
              <td style={{ border: "1px solid #ccc", padding: 6 }}>{r.deltaY}</td>
              <td style={{ border: "1px solid #ccc", padding: 6 }}>
                {r.pass ? "PASS" : "FAIL"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
