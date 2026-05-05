import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

type ButtonVariant = "default" | "primary" | "success" | "danger" | "muted";

type AppButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export function AppButton({
  children,
  variant = "default",
  className = "",
  ...props
}: AppButtonProps) {
  const variantClass = variant === "default" ? "" : ` app-button-${variant}`;

  return (
    <button
      type={props.type || "button"}
      className={`app-button${variantClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

type AppLinkButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
} & AnchorHTMLAttributes<HTMLAnchorElement>;

export function AppLinkButton({
  children,
  variant = "default",
  className = "",
  ...props
}: AppLinkButtonProps) {
  const variantClass = variant === "default" ? "" : ` app-button-${variant}`;

  return (
    <a className={`app-button${variantClass} ${className}`.trim()} {...props}>
      {children}
    </a>
  );
}
