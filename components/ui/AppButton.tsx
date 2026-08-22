import {
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  forwardRef,
  type ReactNode,
} from "react";

/**
 * Canonical action hierarchy (Central UI Standard, Stage 2). `"default"`
 * and `"tertiary"` are the same quiet/ghost treatment -- `"tertiary"` is
 * the explicit, discoverable name for it going forward; `"default"`
 * remains so every existing unset-variant call site is unaffected.
 * `"secondary"` is the persistent-visible-chrome treatment (formerly
 * reachable only as `"muted"`, which is kept as a transitional alias --
 * both produce identical output; new code should prefer `"secondary"`).
 *
 * `"success"`, `"warning"`, and `"start"` are transitional aliases from
 * before System 3 (approved 2026-08-19): affirmative/status-toned
 * action buttons should use `"primary"` going forward (color communicates
 * urgency/destructiveness, not decoration) -- these three remain only for
 * existing call sites and are not part of the canonical hierarchy.
 *
 * `"stop"` is canonical but narrowly scoped (Central UI Standard): the
 * one solid destructive fill, reserved exclusively for a Dialog/
 * ConfirmDialog Confirm step when `danger` is set -- never a general
 * "stop/end this" action button (e.g. ending a running process), which
 * should use `"secondary"`/`"tertiary"` like any other ordinary action.
 * `app/admin/slideshow/page.tsx`'s own `variant="stop"` predates this
 * scoping and both it and its paired `variant="start"` sites are known,
 * unmigrated legacy consumers -- tracked for a future page migration,
 * not touched by this pass (see the Central UI Standard blueprint,
 * "Legacy debt intentionally not touched").
 */
type ButtonVariant =
  | "default"
  | "primary"
  | "secondary"
  | "tertiary"
  | "danger"
  | "stop"
  | "success"
  | "warning"
  | "muted"
  | "start";

const GHOST_VARIANTS = new Set<ButtonVariant>(["default", "tertiary"]);

type AppButtonOwnProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
  /**
   * Standardized loading/busy presentation (Central UI Standard, Stage 2):
   * shows a spinner, sets `aria-busy`, and forces the effective disabled
   * state, so every consumer gets the same "Working..." shape
   * `ConfirmDialog` already established rather than hand-rolling its own.
   */
  loading?: boolean;
};

type AppButtonProps = AppButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement>;

function variantClassName(variant: ButtonVariant): string {
  return GHOST_VARIANTS.has(variant) ? "" : ` app-button-${variant}`;
}

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(
  function AppButton(
    {
      children,
      variant = "default",
      className = "",
      type = "button",
      loading = false,
      disabled,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={`app-button${variantClassName(variant)} ${className}`.trim()}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <span className="app-button-spinner" aria-hidden="true" /> : null}
        {children}
      </button>
    );
  },
);

type AppLinkButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
} & AnchorHTMLAttributes<HTMLAnchorElement>;

export const AppLinkButton = forwardRef<HTMLAnchorElement, AppLinkButtonProps>(
  function AppLinkButton({ children, variant = "default", className = "", ...props }, ref) {
    return (
      <a
        ref={ref}
        className={`app-button${variantClassName(variant)} ${className}`.trim()}
        {...props}
      >
        {children}
      </a>
    );
  },
);
