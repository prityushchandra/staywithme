export const OVERLAY_POP_EVENT = "swm:overlay-pop";

// A window-targeted popstate runs in registration order, even with capture.
// Install before Next hydrates; the overlay hook can load afterward.
export const OVERLAY_HISTORY_BOOTSTRAP =
  `window.addEventListener("popstate",function(event){window.dispatchEvent(new CustomEvent("${OVERLAY_POP_EVENT}",{detail:event}));});`;
