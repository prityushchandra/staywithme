// A template (unlike a layout) re-mounts on every navigation, so its entrance
// animation replays each time the route changes. This gives every page a smooth
// fade + gentle rise instead of an abrupt swap. Reduced-motion users get an
// instant render (handled by the global prefers-reduced-motion rule).
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="duration-300 ease-ios animate-in fade-in slide-in-from-bottom-1">
      {children}
    </div>
  );
}
