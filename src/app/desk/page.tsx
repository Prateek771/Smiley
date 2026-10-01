import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, requireStaffSession } from "@/server/auth";
import { SignOutButton } from "@/features/auth/sign-out-button";

export const dynamic = "force-dynamic";

export default async function DeskPage() {
  const actor = await requireStaffSession(new Headers(await headers())).catch((error: unknown) => {
    if (error instanceof AuthError && error.status === 401) redirect("/login");
    throw error;
  });
  return <main className="min-h-screen bg-slate-100 px-4 py-10">
    <section className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-sm font-semibold text-teal-700">Smiley · Staff desk</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900">Hospital work queue</h1></div>
        <SignOutButton />
      </header>
      <p className="mt-6 text-slate-700">Signed in as {actor.name}.</p>
      <p className="mt-2 text-sm text-slate-600">Your current staff access has been verified. This local environment contains synthetic records only.</p>
      <p className="mt-6 text-sm text-slate-600">Patient registration and persisted case work are coming in the next checked phase.</p>
    </section>
  </main>;
}
