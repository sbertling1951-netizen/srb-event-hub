"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { supabase } from "@/lib/supabase";

type PrintTag = {
  displayFirst: string;
  lastName: string;
  memberNumber: string;
  city: string;
  state: string;
  firstTimer?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function useAutoFitText(
  text: string,
  maxPx: number,
  minPx: number,
  className?: string,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fontSize, setFontSize] = useState(maxPx);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    let next = maxPx;
    el.style.fontSize = `${next}px`;

    const availableWidth = el.clientWidth || el.offsetWidth;
    if (!availableWidth) {
      setFontSize(maxPx);
      return;
    }

    while (next > minPx && el.scrollWidth > availableWidth) {
      next -= 1;
      el.style.fontSize = `${next}px`;
    }

    setFontSize(clamp(next, minPx, maxPx));
  }, [text, maxPx, minPx, className]);

  return { ref, fontSize };
}

function AutoFitText({
  text,
  className,
  maxPx,
  minPx,
}: {
  text: string;
  className: string;
  maxPx: number;
  minPx: number;
}) {
  const { ref, fontSize } = useAutoFitText(text, maxPx, minPx, className);

  return (
    <div ref={ref} className={className} style={{ fontSize: `${fontSize}px` }}>
      {text}
    </div>
  );
}

function NameTagsPrintPageInner() {
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

        if (raw) {
          setTags(JSON.parse(raw));
        }
        if (rawEvent) {
          setEventName(rawEvent);
        }

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
          font-size: 19px;
          line-height: 1.05;
          font-weight: 700;
          margin-bottom: 4px;
          max-width: 100%;
          padding: 0 6px;
          box-sizing: border-box;
        }

        .logo {
          width: 1.45in;
          max-height: 0.9in;
          object-fit: contain;
          margin-bottom: 4px;
          flex-shrink: 0;
        }

        .member {
          font-size: 16px;
          line-height: 1;
          margin-bottom: 5px;
          max-width: 100%;
          padding: 0 6px;
          box-sizing: border-box;
        }

        .first,
        .last,
        .location,
        .first-timer {
          width: calc(100% - 12px);
          box-sizing: border-box;
          overflow-wrap: anywhere;
          word-break: break-word;
          text-align: center;
        }

        .first {
          font-weight: 800;
          line-height: 0.95;
          margin-bottom: 2px;
        }

        .last {
          font-weight: 700;
          line-height: 1;
          margin-bottom: 5px;
        }

        .location {
          font-size: 17px;
          line-height: 1.05;
          margin-top: 1px;
          padding: 0 6px;
        }

        .first-timer {
          margin-top: 5px;
          font-size: 14px;
          line-height: 1;
          font-weight: 800;
          color: #c62828;
          letter-spacing: 0.01in;
          padding: 0 6px;
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

      <div className="sheet">
        {tags.map((tag, index) => (
          <div key={index} className="label">
            {bgUrl ? <img src={bgUrl} alt="" className="label-bg" /> : null}

            <div className="label-content">
              <div className="event">{eventName}</div>

              <img src="/logo.png" className="logo" alt="FCOC logo" />

              <div className="member">{tag.memberNumber}</div>

              <AutoFitText
                text={tag.displayFirst}
                className="first"
                maxPx={64}
                minPx={28}
              />

              <AutoFitText
                text={tag.lastName}
                className="last"
                maxPx={36}
                minPx={18}
              />

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

export default function NameTagsPrintPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_print_settings">
      <NameTagsPrintPageInner />
    </AdminRouteGuard>
  );
}
