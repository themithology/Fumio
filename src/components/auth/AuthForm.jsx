import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  authErrorMessage,
  consumeGoogleIdToken,
  ensureAuthInit,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "../../utils/auth.js";
import { isNativeApp } from "../../utils/externalLinks.js";

const inEmbeddedFrame = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

export default function AuthForm({ initialMode = "signin" }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState(initialMode === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [embedded, setEmbedded] = useState(false);

  const nativeHandoff = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fumioNative") === "1";

  useEffect(() => {
    setEmbedded(inEmbeddedFrame());
    // Warm Auth so Continue with Google can open the popup in this click.
    ensureAuthInit().catch(() => {});
  }, []);

  useEffect(() => {
    const onError = (event) => {
      setBusy(false);
      setError(event?.detail?.message || "Google sign-in failed.");
    };
    const onDone = () => {
      setBusy(false);
      navigate("/account", { replace: true });
    };
    window.addEventListener("fumio-native-auth-error", onError);
    window.addEventListener("fumio-native-auth-done", onDone);
    return () => {
      window.removeEventListener("fumio-native-auth-error", onError);
      window.removeEventListener("fumio-native-auth-done", onDone);
    };
  }, [navigate]);

  const switchMode = (next) => {
    setMode(next);
    setMessage("");
    setError("");
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "signup") await signUpWithEmail(email, password);
      else await signInWithEmail(email, password);
      navigate("/account", { replace: true });
    } catch (authError) {
      setError(authErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  };

  const finishGoogle = (user) => {
    if (!user) return;
    if (nativeHandoff) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") || "com.fumio.app://auth";
      const googleToken = consumeGoogleIdToken();
      if (googleToken) {
        window.location.assign(`${redirect}?idToken=${encodeURIComponent(googleToken)}`);
        return;
      }
    }
    navigate("/account", { replace: true });
  };

  const google = () => {
    setError("");
    setMessage("");
    if (isNativeApp() && window.FumioNative?.signInWithGoogle) {
      setBusy(true);
      window.FumioNative.signInWithGoogle();
      return;
    }
    const pending = signInWithGoogle();
    setBusy(true);
    pending
      .then(finishGoogle)
      .catch((authError) => {
        setError(authErrorMessage(authError));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const forgot = async () => {
    if (!email.trim()) {
      setError("Enter your email first, then choose reset password.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await resetPassword(email);
      setMessage("Password reset email sent. Check your inbox.");
    } catch (authError) {
      setError(authErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl sm:p-7">
      <div className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Optional account</p>
        <h1 className="font-editorial text-3xl font-bold text-white">
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Browse and watch without signing in. An account simply carries My List and Continue Watching between devices.
        </p>
      </div>

      <button
        type="button"
        onClick={google}
        disabled={busy}
        className="relative z-10 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-sm font-black" aria-hidden="true">G</span>
        Continue with Google
      </button>
      {nativeHandoff && (
        <p className="mt-3 text-center text-xs leading-5 text-zinc-400">
          Sign in with Google here, then we send you back to the app.
        </p>
      )}
      {embedded && (
        <p className="mt-3 text-center text-xs leading-5 text-zinc-500">
          Google needs a real browser window.{" "}
          <a href={typeof window === "undefined" ? "/account" : window.location.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-white underline-offset-4 hover:underline">
            Open sign-in in a new tab
          </a>
          , then try Google again.
        </p>
      )}

      <div className="my-5 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
        <span className="h-px flex-1 bg-white/10" />
        or email
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-zinc-300">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-white/35"
            placeholder="you@example.com"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-zinc-300">Password</span>
          <input
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-white/35"
            placeholder="At least 6 characters"
          />
        </label>

        {mode === "signin" && (
          <button type="button" onClick={forgot} disabled={busy} className="text-xs font-semibold text-zinc-400 underline-offset-4 hover:text-white hover:underline disabled:opacity-60">
            Reset password
          </button>
        )}

        {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-200">{error}</p>}
        {message && <p role="status" className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs leading-5 text-emerald-200">{message}</p>}

        <button
          type="submit"
          disabled={busy}
          className="min-h-11 w-full rounded-xl bg-white px-4 text-sm font-extrabold text-black transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-500">
        {mode === "signup" ? "Already have an account?" : "New to accounts?"}{" "}
        <button type="button" onClick={() => switchMode(mode === "signup" ? "signin" : "signup")} className="font-bold text-white hover:underline">
          {mode === "signup" ? "Sign in" : "Create one"}
        </button>
      </p>
    </div>
  );
}
