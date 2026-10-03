import Link from "next/link";
import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold text-teal-700">Smiley · Staff desk</p>
      <h1 className="mt-3 text-3xl font-semibold text-slate-900">Sign in to your hospital</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Use your invited staff account to access your hospital’s claims and discharge workspace.</p>
      <LoginForm />
      <p className="mt-6 text-sm text-slate-600">Need access? Ask your hospital administrator for an invitation.</p>
      <Link href="/demo" className="mt-5 inline-block text-sm font-semibold text-teal-700 underline">Explore the training demo</Link>
    </section>
  </main>;
}
