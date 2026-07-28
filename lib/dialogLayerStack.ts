/**
 * Coordinates which client-side dialog is "on top" when more than one can
 * be mounted at once (e.g. `PreferredMapChooser` opened from a control
 * inside an already-open `ObjectPanel`).
 *
 * Each dialog component pushes a layer while it is open and pops it on
 * close. A single Escape key press should only close the most recently
 * opened (topmost) dialog rather than cascading through every open dialog
 * at once -- `isTopDialogLayer` lets each dialog's own Escape handler check
 * whether it is the one that should react before acting.
 *
 * This module intentionally holds plain in-memory state (not React state):
 * it only needs to coordinate dialogs that are actually mounted together
 * within the same page session, and doesn't need to survive navigation or
 * reloads.
 */

const stack: symbol[] = [];

export function pushDialogLayer(): symbol {
  const id = Symbol("dialog-layer");
  stack.push(id);
  return id;
}

export function popDialogLayer(id: symbol) {
  const index = stack.lastIndexOf(id);

  if (index !== -1) {
    stack.splice(index, 1);
  }
}

export function isTopDialogLayer(id: symbol): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}
