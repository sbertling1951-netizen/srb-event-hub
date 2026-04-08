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
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          text-align: center;
          overflow: hidden;
        }

        .event {
          font-size: 0.55in;
          line-height: 1.02;
          font-weight: 700;
          margin-bottom: 0.18in;
        }

        .logo {
          width: 3.0in;
          max-height: 2.0in;
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
        <button onClick={() => window.print()}>Print Coach Plates</button>
      </div>

      <div className="pages">
        {plates.map((plate, index) => (
          <div key={index} className="page">
            <div className="plate">
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
        ))}
      </div>
    </div>
  );
}
