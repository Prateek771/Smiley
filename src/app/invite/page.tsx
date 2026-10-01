import { InvitationForm } from "@/features/auth/invitation-form";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold text-teal-700">Smiley · Staff invitation</p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-900">Join your hospital desk</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">The invitation defines your hospital, branch, and staff role.</p>
      <InvitationForm token={typeof token === "string" ? token : ""} />
    </section>
  </main>;
}
