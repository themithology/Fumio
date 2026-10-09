import { useEffect, useState } from "react";
import { isInMyList, toggleMyList } from "../../utils/myList.js";

// Keep the hero action in sync with the same device-local My List used by
// Details, My List, and the account sync layer. This also means a Home hero
// can be personalized from the user's own list without uploading a profile.
export const useHeroWatchlist = (items, currentIndex, defaultType) => {
  const [inMyList, setInMyList] = useState(false);
  const item = items[currentIndex];
  const type = item?.media_type || defaultType || (item?.title ? "movie" : "tv");

  useEffect(() => {
    const sync = () => setInMyList(item ? isInMyList(item, type) : false);
    sync();
    window.addEventListener("mylist-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("mylist-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, [item, type]);

  const toggleSaved = () => {
    if (!item) return;
    setInMyList(toggleMyList({ ...item, type }));
  };

  return [inMyList, toggleSaved];
};
