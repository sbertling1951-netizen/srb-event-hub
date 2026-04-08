"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type PrintTag = {
  displayFirst: string;
  lastName: string;
  memberNumber: string;
  city: string;
  state: string;
  firstTimer?: boolean;
};

export default function NameTagsPrintPage() {
  const [tags, setTags] = useState<PrintTag[]>([]);
  const [eventName, setEventName] = useState("");
  const [bgUrl, setBgUrl] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const raw = sessionStorage.getItem("fcoc-name-tags");
        const rawEvent = sessionStorage.getItem("fcoc-name-tags-event");
        const rawEventContext = localStorage.getItem(
          "fcoc-admin-event-context",
        );

        if (raw) setTags(JSON.parse(raw));
        if (rawEvent) setEventName(rawEvent);

        if (rawEventContext) {
          const parsed = JSON.parse(rawEventContext);
          const eventId = parsed?.id;

          if (eventId) {
            const { data, error } = await supabase
              .from("event_print_settings")
              .select("name_tag_bg_url")
              .eq("event_id", eventId)
              .maybeSingle();

            if (!error) {
              setBgUrl(data?.name_tag_bg_url || null);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load name tags:", err);
      }
    }

    void load();
  }, []);

  return (
    <div>
      <style>{`
        @page {
          size: letter portrait;
          margin: 0.35in 0.3in;
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

        .sheet {
          display: grid;
          grid-template-columns: repeat(2, 4in);
          grid-auto-rows: 3.33in;
          justify-content: center;
          gap: 0;
        }

        .label {
          width: 4in;
          height: 3.33in;
          box-sizing: border-box;
          padding: 0.12in 0.18in 0.12in 0.18in;
          overflow: hidden;
          page-break-inside: avoid;
          position: relative;
          display: flex;
          align-items: stretch;
          justify-content: stretch;
        }

        .label-bg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          z-index: 0;
        }

        .label-content {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          text-align: center;
          position: relative;
          z-index: 1;
          background: rgba(255, 255, 255, 0.12);
          border-radius: 0.08in;
          padding-top: 0.02in;
        }

        .event {
          font-size: 0.26in;
          line-height: 1.05;
          font-weight: 700;
          margin-bottom: 0.06in;
        }

        .logo {
          width: 1.45in;
          max-height: 0.9in;
          object-fit: contain;
          margin-bottom: 0.05in;
        }

        .member {
          font-size: 0.22in;
          line-height: 1;
          margin-bottom: 0.07in;
        }

        .first {
          font-size: 0.62in;
          line-height: 0.95;
          font-weight: 800;
          margin-bottom: 0.02in;
          max-width: 100%;
          word-break: break-word;
        }

        .last {
          font-size: 0.34in;
          line-height: 1;
          font-weight: 700;
          margin-bottom: 0.05in;
          max-width: 100%;
          word-break: break-word;
        }

        .location {
          font-size: 0.23in;
          line-height: 1.05;
          margin-top: 0.01in;
          max-width: 100%;
          word-break: break-word;
        }

        .first-timer {
          margin-top: 0.05in;
          font-size: 0.19in;
          line-height: 1;
          font-weight: 800;
          color: #c62828;
          letter-spacing: 0.01in;
        }

        @media print {
          .toolbar {
            display: none;
          }

          aside {
            display: none !important;
          }
        }
      `}</style>

      <div className="toolbar">
        <button onClick={() => window.print()}>Print Name Tags</button>
      </div>

      <div className="sheet">
        {tags.map((tag, index) => (
          <div key={index} className="label">
            {bgUrl ? <img src={bgUrl} alt="" className="label-bg" /> : null}

            <div className="label-content">
              <div className="event">{eventName}</div>

              <img src="/logo.png" className="logo" alt="FCOC logo" />

              <div className="member">{tag.memberNumber}</div>

              <div className="first">{tag.displayFirst}</div>
              <div className="last">{tag.lastName}</div>

              <div className="location">
                {tag.city}
                {tag.city && tag.state ? ", " : ""}
                {tag.state}
              </div>

              {tag.firstTimer ? (
                <div className="first-timer">FIRST TIMER</div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
