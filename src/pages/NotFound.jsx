import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-2xl font-black">Page not found</h1>
      <Link to="/" className="rounded-full bg-white px-5 py-2 text-sm font-bold text-black hover:bg-zinc-200">
        Go Home
      </Link>
    </div>
  );
}
