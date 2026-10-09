// Compact server controls shared by the preferred and fallback player lanes.
// It lives below the video frame so it stays reachable on touch devices and
// never covers the embedded player's own controls.
export default function ServerPickerBar({ sources = [], activeId, onSelect, disabled = false }) {
  if (!sources.length) return null;

  return (
    <div className="shrink-0 border-t border-white/10 bg-black/95 px-3 py-2.5 sm:px-4">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2">
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
          <i className="ri-server-line text-sm text-zinc-400" aria-hidden="true" />
          <span className="hidden xs:inline">Servers</span>
        </span>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex min-w-max gap-1.5">
            {sources.map((source) => {
              const active = source.id === activeId;
              return (
                <button
                  key={source.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(source)}
                  title={source.quality || source.name}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[10px] font-bold transition active:scale-95 sm:text-[11px] ${
                    active
                      ? "border-white bg-white text-black shadow-lg shadow-white/10"
                      : "border-white/10 bg-white/[0.06] text-zinc-300 hover:border-white/25 hover:bg-white/10 hover:text-white"
                  } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-black" aria-hidden="true" />}
                  <span>{source.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
