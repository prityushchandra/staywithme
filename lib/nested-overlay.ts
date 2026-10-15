export const NESTED_OVERLAY_ATTR = "data-nested-overlay";

type RadixOutsideEvent = {
  target: EventTarget | null;
  detail?: { originalEvent?: { target?: EventTarget | null } };
  preventDefault: () => void;
};

function inNestedOverlay(target: EventTarget | null | undefined): boolean {
  return target instanceof Element && !!target.closest(`[${NESTED_OVERLAY_ATTR}]`);
}

/**
 * Radix decides "outside" by DOM containment, so an overlay that a child
 * portalled to <body> — the fullscreen date picker inside the mobile filter
 * sheet — reads as outside and dismisses the modal on the first tap. Tagging
 * those portals with `data-nested-overlay` lets the modal recognise its own
 * descendants and leave itself open.
 *
 * Pass as `onPointerDownOutside` / `onFocusOutside` / `onInteractOutside`.
 */
export function guardNestedOverlay(event: RadixOutsideEvent): void {
  if (inNestedOverlay(event.target) || inNestedOverlay(event.detail?.originalEvent?.target)) {
    event.preventDefault();
  }
}
