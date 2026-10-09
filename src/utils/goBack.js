// Safe in-app back navigation: go back in the SPA history when there is one
// (React Router keeps a stack index in window.history.state.idx); otherwise
// fall back to a real in-app route instead of leaving the site entirely.
export const safeBack = (navigate, fallback = "/") => {
  const idx = window.history?.state?.idx;
  if (typeof idx === "number" && idx > 0) {
    navigate(-1);
  } else {
    navigate(fallback);
  }
};
