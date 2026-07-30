"use client";

import type { Route } from "next";
import Link from "next/link";

// Shared visual treatment for the three login pages (Member/Admin/Vendor)
// only. Not a general design system -- deliberately local to this one
// approved layout. Plain inline styles rather than the .app-button classes:
// .app-button locks text color via `color: ... !important`, which would
// fight the pastel variants below rather than layer cleanly on top of them.
// No custom focus-visible rule is added because nothing in globals.css
// suppresses the browser's native outline on plain <button>/<a> elements --
// keyboard focus is already visible without extra CSS.
export type LoginActionVariant = "primary" | "recovery" | "alternate" | "back";

const VARIANT_STYLES: Record<LoginActionVariant, React.CSSProperties> = {
  // Strong blue -- reserved for the single primary sign-in/login action.
  primary: {
    background: "#0b5cff",
    borderColor: "#0b5cff",
    color: "#ffffff",
  },
  // Pale yellow -- password recovery.
  recovery: {
    background: "#fef3c7",
    borderColor: "#fcd34d",
    color: "#78350f",
  },
  // Pale green -- alternate access / account-access requests.
  alternate: {
    background: "#dcfce7",
    borderColor: "#86efac",
    color: "#14532d",
  },
  // Pale pink -- navigation back to the login selector.
  back: {
    background: "#fce7f3",
    borderColor: "#f9a8d4",
    color: "#831843",
  },
};

const BASE_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  minHeight: 46,
  padding: "12px 16px",
  borderRadius: 8,
  borderWidth: 1,
  borderStyle: "solid",
  fontWeight: 700,
  fontSize: 15,
  lineHeight: 1.25,
  textDecoration: "none",
  boxSizing: "border-box",
  textAlign: "center",
};

type CommonProps = {
  variant: LoginActionVariant;
  children: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
};

type LinkActionProps = CommonProps & {
  href: string;
  type?: undefined;
  onClick?: undefined;
};

type ButtonActionProps = CommonProps & {
  href?: undefined;
  type?: "button" | "submit";
  onClick?: () => void;
};

type LoginActionButtonProps = LinkActionProps | ButtonActionProps;

export default function LoginActionButton(props: LoginActionButtonProps) {
  const { variant, children, disabled, style } = props;

  const computedStyle: React.CSSProperties = {
    ...BASE_STYLE,
    ...VARIANT_STYLES[variant],
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    ...style,
  };

  if (props.href) {
    return (
      <Link href={props.href as Route} style={computedStyle}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type={props.type || "button"}
      onClick={props.onClick}
      disabled={disabled}
      style={computedStyle}
    >
      {children}
    </button>
  );
}
