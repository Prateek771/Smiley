"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";

const subscribeToHydration = () => () => undefined;
const clientHydrated = () => true;
const serverHydrated = () => false;

export function LoginForm() {
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: values.get("email"), password: values.get("password") }),
      });
      if (!response.ok) { setError("Sign-in failed. Check your credentials and active staff access."); return; }
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Fetch changed the auth cookie; one document navigation avoids the observed RSC navigation/refresh stall.
      window.location.assign("/desk");
    } catch { setError("Sign-in is unavailable. Please retry."); }
    finally { setPending(false); }
  }
  return <form method="post" onSubmit={submit} className="mt-8 space-y-5">
    <noscript><p role="alert" className="text-sm text-red-700">Enable JavaScript to sign in securely.</p></noscript>
    <div><label htmlFor="email" className="block text-sm font-semibold text-slate-700">Work email</label>
      <input disabled={!hydrated || pending} id="email" name="email" type="email" autoComplete="username" required maxLength={150} className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" /></div>
    <div><label htmlFor="password" className="block text-sm font-semibold text-slate-700">Password</label>
      <input disabled={!hydrated || pending} id="password" name="password" type="password" autoComplete="current-password" required className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" /></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button disabled={!hydrated || pending} type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-60">{pending ? "Signing in…" : "Sign in"}</button>
  </form>;
}
