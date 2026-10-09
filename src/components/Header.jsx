import { Link } from "react-router-dom";

export default function Header() {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/5 bg-black/70 px-4 py-3 backdrop-blur sm:px-8">
      <Link to="/" className="flex items-center gap-2.5">
        <img src="/logo.svg" alt="TheOGPirateBot" className="h-8 w-8" />
        <span className="text-lg font-black tracking-tight">TheOGPirateBot</span>
      </Link>
    </header>
  );
}
