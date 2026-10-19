import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAccount.js";
import { displayInitial, isRealUser } from "../../utils/auth.js";
import { DISCORD_INVITE_URL } from "../../utils/externalLinks.js";
import { LOOK_EVENT, LOOK_SYNCED_EVENT, readLook } from "../../utils/profileLook.js";

const Topnav = () => {
  const { user } = useAuth();
  const signedIn = isRealUser(user);
  const [look, setLook] = useState(readLook);
  const picture = look.avatar || user?.photoURL || "";

  useEffect(() => {
    const reload = () => setLook(readLook());
    window.addEventListener(LOOK_EVENT, reload);
    window.addEventListener(LOOK_SYNCED_EVENT, reload);
    return () => {
      window.removeEventListener(LOOK_EVENT, reload);
      window.removeEventListener(LOOK_SYNCED_EVENT, reload);
    };
  }, []);

  return (
    <header className="sticky top-0 z-[100] w-full border-b border-white/[0.06] bg-black/85 backdrop-blur-md select-none">
      <div className="mx-auto flex h-[52px] w-full max-w-[1600px] items-center justify-between gap-2 px-3 sm:px-6 lg:px-10">
        <Link to="/" aria-label="TheOGPirateBot Home" className="group flex min-w-0 shrink-0 items-center gap-2.5 text-white">
          <img src="/logo.svg" alt="" className="h-8 w-8 shrink-0" />
          <span className="hidden font-display text-[13px] font-bold tracking-tight group-hover:text-zinc-200 xs:inline sm:text-sm">TheOGPirateBot</span>
        </Link>
        <div className="gtv-no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto sm:gap-2">
          <Link
            to="/explore"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            <i className="ri-equalizer-line text-sm" aria-hidden="true" />
            <span className="hidden sm:inline">Explore</span>
          </Link>
          <Link
            to="/schedule"
            aria-label="Anime schedule"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            <i className="ri-calendar-event-line text-sm" aria-hidden="true" />
            <span className="hidden sm:inline">Schedule</span>
          </Link>
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Join our Discord community"
            className="relative z-10 pointer-events-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 text-xs font-bold text-indigo-100 transition hover:border-indigo-200/40 hover:bg-indigo-300/20 hover:text-white"
          >
            <i className="ri-discord-fill" aria-hidden="true" />
            <span>Join Discord</span>
          </a>
          {signedIn ? (
            <Link
              to="/account"
              aria-label="Open account"
              className="inline-flex h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/20 bg-white p-0 text-black transition hover:opacity-90"
            >
              {picture ? (
                <img src={picture} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="grid h-full w-full place-items-center text-xs font-black">{displayInitial(user)}</span>
              )}
            </Link>
          ) : (
            <Link
              to="/account"
              aria-label="Sign in"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-bold text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              <i className="ri-user-line" aria-hidden="true" />
              <span className="hidden sm:inline">Sign in</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};

export default Topnav;
