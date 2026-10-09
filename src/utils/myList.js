const MY_LIST_KEY = "myList";
export const MY_LIST_UPDATED_EVENT = "mylist-updated";
export const MY_LIST_CAP = 100;

const storage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const readJson = (raw) => {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value.filter((item) => item && item.id) : [];
  } catch {
    return [];
  }
};

const keyOf = (item) => `${item?.type || item?.media_type || "movie"}-${item?.id}`;

const emit = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MY_LIST_UPDATED_EVENT));
};

export const readMyList = () => readJson(storage()?.getItem(MY_LIST_KEY));

export const isInMyList = (itemOrId, mediaType = "movie") => {
  const key = typeof itemOrId === "object" ? keyOf(itemOrId) : `${mediaType}-${itemOrId}`;
  return readMyList().some((item) => keyOf(item) === key);
};

export const writeMyList = (list) => {
  const seen = new Set();
  const clean = (Array.isArray(list) ? list : [])
    .filter((item) => item && item.id)
    .map((item) => ({ ...item, type: item.type || item.media_type || "movie" }))
    .filter((item) => {
      const key = keyOf(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b.addedAt || 0) - Number(a.addedAt || 0))
    .slice(0, MY_LIST_CAP);
  try {
    storage()?.setItem(MY_LIST_KEY, JSON.stringify(clean));
  } catch {
    return false;
  }
  emit();
  return true;
};

export const addToMyList = (item) => {
  if (!item?.id) return false;
  const key = keyOf(item);
  const next = readMyList().filter((entry) => keyOf(entry) !== key);
  next.unshift({
    ...item,
    type: item.type || item.media_type || "movie",
    media_type: item.media_type || item.type || "movie",
    addedAt: Date.now(),
  });
  return writeMyList(next);
};

export const removeFromMyList = (itemOrId, mediaType = "movie") => {
  const key = typeof itemOrId === "object" ? keyOf(itemOrId) : `${mediaType}-${itemOrId}`;
  return writeMyList(readMyList().filter((item) => keyOf(item) !== key));
};

export const toggleMyList = (item) => (isInMyList(item) ? (removeFromMyList(item), false) : (addToMyList(item), true));
export const myListKey = (item) => keyOf(item);
