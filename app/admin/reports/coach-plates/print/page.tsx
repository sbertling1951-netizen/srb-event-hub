"use client";

import { useEffect, useState } from "react";

type CoachPlate = {
  eventName: string;
  memberNumber: string;
  pilotDisplay: string;
  copilotDisplay: string;
  city: string;
  state: string;
  firstTimer?: boolean;
};

export default function CoachPlatesPrintPage() {
  const [plates, setPlates] = useState<CoachPlate[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("fcoc-coach-plates");
      if (raw) setPlates(JSON.parse(raw));
    } catch (err) {
      console.error("Failed to load coach plates:", err);
    }
  }, []);

  return (
    <div>
      <style>{`
        @page {
          size: letter landscape;
          margin: 0.35in;
        }

        html, body {
          margin: 0;
          padding: 0;
          font-family: Arial, Helvetica, sans-serif;
          background: white;
        }

        .toolbar {
          padding: 12px;
        }

        .pages {
          display: block;
        }

        .page {
          width: 11in;
          height: 8.5in;
          box-sizing: border-box;
          page-break-after: always;
          padding: 0.35in;
          display: flex;
          align-items: stretch;
          justify-content: stretch;
        }

        .plate {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border: 2px solid #999;
          border-radius: 18px;
          padding: 0.35in 0.45in;
          overflow: hidden;
          position: relative;
          background-image: url("/coach-plate-bg.png");
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          display: flex;
          align-items: stretch;
          justify-content: stretch;
        }

        .plate-content {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          text-align: center;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 12px;
        }

        .event {
          font-size: 0.55in;
          line-height: 1.02;
          font-weight: 700;
          margin-bottom: 0.18in;
          margin-top: 0.05in;
        }

        .logo {
          width: 3in;
          max-height: 2in;
          object-fit: contain;
          margin-bottom: 0.14in;
        }

        .member {
          font-size: 0.36in;
          line-height: 1;
          margin-bottom: 0.18in;
        }

        .pilot {
          font-size: 0.95in;
          line-height: 0.95;
          font-weight: 800;
          margin-bottom: 0.08in;
          max-width: 100%;
          word-break: break-word;
        }

        .copilot {
          font-size: 0.58in;
          line-height: 1;
          font-weight: 700;
          margin-bottom: 0.14in;
          max-width: 100%;
          word-break: break-word;
        }

        .location {
          font-size: 0.42in;
          line-height: 1.05;
          margin-top: 0.06in;
          max-width: 100%;
          word-break: break-word;
        }

        .first-timer {
          margin-top: 0.16in;
          font-size: 0.34in;
          line-height: 1;
          font-weight: 800;
          color: #c62828;
          letter-spacing: 0.02in;
        }

        @media print {
          .toolbar {
            display: none;
          }
        }
      `}</style>

      <div className="toolbar">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => window.print()}>Print / Save PDF</button>

          <button
            onClick={() =>
              alert(
                "In the print dialog, choose Destination: Save as PDF to create a PDF backup.",
              )
            }
          >
            How to Save PDF
          </button>
        </div>
      </div>

      <div className="pages">
        {plates.map((plate, index) => (
          <div key={index} className="page">
            <div className="plate">
              <div className="plate-content">
                <div className="event">{plate.eventName}</div>

                <img src="/logo.png" className="logo" alt="FCOC logo" />

                <div className="member">{plate.memberNumber}</div>

                <div className="pilot">{plate.pilotDisplay}</div>

                {plate.copilotDisplay ? (
                  <div className="copilot">{plate.copilotDisplay}</div>
                ) : null}

                <div className="location">
                  {plate.city}
                  {plate.city && plate.state ? ", " : ""}
                  {plate.state}
                </div>

                {plate.firstTimer ? (
                  <div className="first-timer">FIRST TIMER</div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
