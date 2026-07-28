export type CopyTextResult = { success: boolean };

/**
 * Copies plain text to the clipboard, preferring the async Clipboard API
 * and falling back to a hidden `<textarea>` + `document.execCommand("copy")`
 * when that API is unavailable.
 *
 * `navigator.clipboard` is not just "sometimes rejects" -- on non-secure
 * origins (plain HTTP, e.g. a LAN development URL) it is `undefined`
 * entirely, so calling `.writeText` directly throws a TypeError before
 * any promise rejection has a chance to be caught. This helper checks for
 * the API rather than assuming it, and never throws or leaves an
 * uncaught rejection: callers always get back a plain `{ success }`
 * result, with no browser-specific error detail exposed.
 *
 * Client-safe and framework-agnostic -- guards `window`/`document` for
 * any non-browser evaluation, cleans up its own DOM node in a `finally`
 * block, and restores whatever selection/focus existed beforehand where
 * practical. Contains no feature-specific (e.g. Nearby) logic, so it's
 * safe to reuse for any other copy-to-clipboard action in the app.
 */
export async function copyTextToClipboard(
  text: string,
): Promise<CopyTextResult> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { success: false };
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { success: true };
    } catch {
      // Some browsers expose the API but still reject (e.g. a denied
      // permission prompt) -- fall through to the legacy fallback rather
      // than giving up immediately.
    }
  }

  return copyTextWithFallbackTextarea(text);
}

function copyTextWithFallbackTextarea(text: string): CopyTextResult {
  const previousActiveElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const previousSelection = window.getSelection();
  const previousRange =
    previousSelection && previousSelection.rangeCount > 0
      ? previousSelection.getRangeAt(0).cloneRange()
      : null;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Off-screen rather than hidden -- some browsers refuse to copy from an
  // element that's `display: none` or has no layout size.
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    const succeeded = document.execCommand("copy");

    return { success: succeeded };
  } catch {
    return { success: false };
  } finally {
    document.body.removeChild(textarea);

    if (previousRange && previousSelection) {
      previousSelection.removeAllRanges();
      previousSelection.addRange(previousRange);
    }

    previousActiveElement?.focus();
  }
}
