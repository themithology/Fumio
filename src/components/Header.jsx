import { Link } from "react-router-dom";

export default function Header() {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/5 bg-black/70 px-4 py-3 backdrop-blur sm:px-8">
      <Link to="/" className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black font-black">F</span>
        <span className="text-lg font-black tracking-tight">Fumio</span>
      </Link>
      <span className="ml-1 text-xs text-zinc-600">Details + Player</span>
    </header>
  );
}
