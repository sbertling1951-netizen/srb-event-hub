import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from "react";

/** Props `Field` injects into its control render-prop -- spread these
 * directly onto `Input`/`Select`/`Textarea` (or any native control). */
export type FieldControlProps = {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  "aria-required": true | undefined;
  disabled?: boolean;
};

export type FieldProps = {
  label: ReactNode;
  required?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  disabled?: boolean;
  className?: string;
  children: (controlProps: FieldControlProps) => ReactNode;
};

/**
 * Canonical label/control/help/error wrapper (Central UI Standard,
 * Stage 2) -- the shared shape "the shared Field pattern should own
 * consistent label, required indication, help text, validation/error
 * text, control association" asks for. Generates one id and wires
 * `aria-describedby`/`aria-invalid`/`aria-required` for whatever native
 * control the caller renders via the `children` render-prop, e.g.:
 *
 *   <Field label="Email" error={emailError}>
 *     {(controlProps) => <Input {...controlProps} value={email} onChange={...} />}
 *   </Field>
 *
 * A render-prop (not context, not cloning) so the wiring stays explicit
 * and type-checked rather than implicit -- no unnecessary abstraction
 * beyond generating the id and the aria attribute list once.
 *
 * Checkbox/Radio (below) intentionally do not use Field -- their native
 * inline "control, then label text" shape is different enough from every
 * other control's "label above control" shape that forcing them through
 * the same wrapper would fight the native layout, not serve it.
 */
export function Field({
  label,
  required = false,
  help,
  error,
  disabled = false,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      className={["app-field", disabled ? "app-field-disabled" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <label htmlFor={id} className="app-field-label">
        {label}
        {required ? (
          <span className="app-field-required" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
        disabled,
      })}

      {help ? (
        <p id={helpId} className="app-field-help">
          {help}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="app-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = { className?: string } & InputHTMLAttributes<HTMLInputElement>;

/** Canonical text input -- applies `.app-control`; use inside `Field`. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", ...props },
  ref,
) {
  return <input ref={ref} className={`app-control ${className}`.trim()} {...props} />;
});

type SelectProps = { className?: string } & SelectHTMLAttributes<HTMLSelectElement>;

/** Canonical select -- applies `.app-control`; use inside `Field`. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = "", ...props },
  ref,
) {
  return <select ref={ref} className={`app-control ${className}`.trim()} {...props} />;
});

type TextareaProps = { className?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Canonical textarea -- applies `.app-control`; use inside `Field`. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className = "", ...props },
  ref,
) {
  return <textarea ref={ref} className={`app-control ${className}`.trim()} {...props} />;
});

type CheckableProps = {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">;

/**
 * Native checkbox with its own inline label, help, and error -- see
 * `Field`'s doc comment for why this doesn't route through `Field`
 * itself. Renders a bare, unstyled `<input type="checkbox">` (native
 * rendering is preserved deliberately); `.app-field-checkbox-label`
 * gives the clickable label a real touch target without resizing the
 * checkbox itself.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckableProps>(function Checkbox(
  { label, help, error, className = "", id: idProp, ...props },
  ref,
) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="app-field-checkable">
      <label htmlFor={id} className="app-field-checkable-label">
        <input
          ref={ref}
          type="checkbox"
          id={id}
          className={className}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        <span>{label}</span>
      </label>

      {help ? (
        <p id={helpId} className="app-field-help">
          {help}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="app-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});

/** Native radio button -- see `Checkbox` above; identical shape, `type="radio"`. */
export const Radio = forwardRef<HTMLInputElement, CheckableProps>(function Radio(
  { label, help, error, className = "", id: idProp, ...props },
  ref,
) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="app-field-checkable">
      <label htmlFor={id} className="app-field-checkable-label">
        <input
          ref={ref}
          type="radio"
          id={id}
          className={className}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        <span>{label}</span>
      </label>

      {help ? (
        <p id={helpId} className="app-field-help">
          {help}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="app-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
