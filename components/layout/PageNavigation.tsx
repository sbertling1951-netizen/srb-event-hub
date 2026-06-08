"use client";

import type { CSSProperties } from "react";

type PageNavigationProps = {
  homeHref: string;
  homeLabel: string;
  parentHref?: string;
  parentLabel?: string;
};

const dashboardButtonStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
  width: "auto",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const parentButtonStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 8,
  border: "1px solid #c5ae82",
  background: "#e8d8b5",
  color: "#4f3f25",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
  width: "auto",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

export default function PageNavigation({
  homeHref,
  homeLabel,
  parentHref,
  parentLabel,
}: PageNavigationProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        marginBottom: 16,
      }}
    >
      <button
        type="button"
        onClick={() => {
          window.location.href = homeHref;
        }}
        style={dashboardButtonStyle}
      >
        ← {homeLabel}
      </button>

      {parentHref && parentLabel ? (
        <button
          type="button"
          onClick={() => {
            window.location.href = parentHref;
          }}
          style={parentButtonStyle}
        >
          ← {parentLabel}
        </button>
      ) : null}
    </div>
  );
}
