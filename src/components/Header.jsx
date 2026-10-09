import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";

export default function Header() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const trimmed = q.trim();
    if (trimmed) navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/5 bg-black/70 px-4 py-3 backdrop-blur sm:px-8">
      <Link to="/" className="flex shrink-0 items-center gap-2.5">
        <img src="/logo.svg" alt="TheOGPirateBot" className="h-8 w-8" />
        <span className="hidden text-lg font-black tracking-tight sm:inline">TheOGPirateBot</span>
      </Link>
      <form onSubmit={submit} className="ml-auto flex w-full max-w-xs items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          placeholder="Search movies & TV…"
          className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-white placeholder:text-zinc-500 focus:border-white/30 focus:outline-none"
        />
      </form>
    </header>
  );
}
