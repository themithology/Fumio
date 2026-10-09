export default function Loading({ label = "Loading…" }) {
  return (
    <div className="flex h-[50vh] w-full flex-col items-center justify-center gap-3 text-zinc-500">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-800 border-t-white" />
      <span className="text-xs font-semibold uppercase tracking-widest">{label}</span>
    </div>
  );
}
