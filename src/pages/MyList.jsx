import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Topnav from "../components/partials/Topnav.jsx";
import HorizontalCards from "../components/partials/HorizontalCards.jsx";
import Footer from "../components/Footer.jsx";
import { readMyList, removeFromMyList } from "../utils/myList.js";

export default function MyList() {
  const [items, setItems] = useState(() => readMyList());

  useEffect(() => {
    document.title = "My List | TheOGPirateBot";
    const refresh = () => setItems(readMyList());
    window.addEventListener("mylist-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("mylist-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <div className="min-h-screen w-full bg-[var(--gtv-bg)] text-white">
      <Topnav />
      <main className="mx-auto w-full max-w-7xl px-4 pb-28 pt-8 sm:px-8 md:px-12 lg:px-16 xl:px-20">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Your library</p>
            <h1 className="mt-2 font-editorial text-4xl font-bold text-white">My List</h1>
            <p className="mt-2 text-sm text-zinc-400">Saved locally by default, and synced when you sign in.</p>
          </div>
          <Link to="/account" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-xs font-bold text-zinc-200 transition hover:bg-white/10"><i className="ri-user-line" /> Account & sync</Link>
        </div>
        {items.length ? (
          <div className="mt-8"><HorizontalCards data={items} grid stagger onRemove={(item) => removeFromMyList(item)} /></div>
        ) : (
          <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
            <i className="ri-bookmark-3-line text-5xl text-zinc-700" />
            <h2 className="mt-4 text-lg font-bold text-white">Your list is empty</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">Open a title and choose Add to My List. It will stay available here even when you are signed out.</p>
            <Link to="/explore" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-black text-black hover:bg-zinc-200">Browse titles</Link>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
