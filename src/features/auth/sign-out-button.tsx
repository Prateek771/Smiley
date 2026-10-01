"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function signOut() {
    setPending(true); setError(false);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) { setError(true); return; }
      router.push("/login"); router.refresh();
    } catch { setError(true); }
    finally { setPending(false); }
  }
  return <div><button type="button" onClick={signOut} disabled={pending} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-60">{pending ? "Signing out…" : "Sign out"}</button>{error && <p role="alert" className="mt-2 text-sm text-red-700">Sign-out failed. Please retry.</p>}</div>;
}
