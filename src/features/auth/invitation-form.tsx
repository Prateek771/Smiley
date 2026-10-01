"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export function InvitationForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setPending(true);
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/staff/invitations/accept", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, name: values.get("name"), password: values.get("password") }),
      });
      if (!response.ok) { setError("The invitation cannot be accepted. Check your password or request a new invitation."); return; }
      setAccepted(true);
    } catch { setError("Invitation acceptance is unavailable. Please retry."); }
    finally { setPending(false); }
  }
  if (accepted) return <div className="mt-6"><p role="status" className="text-teal-800">Your staff account is ready.</p><Link href="/login" className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-3 text-white">Continue to sign in</Link></div>;
  if (!token) return <p role="alert" className="mt-6 text-red-700">An invitation link is required. Ask your hospital administrator for one.</p>;
  return <form onSubmit={submit} className="mt-6 space-y-5">
    <div><label htmlFor="name" className="block text-sm font-semibold text-slate-700">Your name</label><input id="name" name="name" required maxLength={100} autoComplete="name" className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" /></div>
    <div><label htmlFor="password" className="block text-sm font-semibold text-slate-700">Choose a password</label><input id="password" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" aria-describedby="password-help" className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-3" /><p id="password-help" className="mt-2 text-xs text-slate-600">Use at least 12 characters.</p></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button type="submit" disabled={pending} className="w-full rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-60">{pending ? "Creating account…" : "Accept invitation"}</button>
  </form>;
}
