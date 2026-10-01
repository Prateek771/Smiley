"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthError } from "@/server/auth";
import { registerPatient, addMembership, registerEncounter, createCase } from "@/server/cases";
import { respondFailure } from "@/server/http";

export type FormState = { error: string | null };
const field = (form: FormData, name: string) => String(form.get(name) ?? "");
async function failed(error: unknown): Promise<FormState> {
  if (error instanceof AuthError && error.status === 401) redirect("/login");
  const response = respondFailure(error);
  const body = await response.json() as { error?: string };
  return { error: body.error ?? "The request could not be completed. Please retry." };
}
function registrationDone(patientId: string, notice: string): never {
  revalidatePath("/desk");
  redirect(`/desk/new?${new URLSearchParams({ patientId, notice })}`);
}
export async function patientAction(_state: FormState, form: FormData): Promise<FormState> {
  let patientId: string;
  try {
    patientId = (await registerPatient(new Headers(await headers()), { patientCode: field(form, "patientCode"), firstName: field(form, "firstName"), lastName: field(form, "lastName"), mobile: field(form, "mobile") })).id;
  } catch (error) { return failed(error); }
  registrationDone(patientId, "patient");
}
export async function membershipAction(_state: FormState, form: FormData): Promise<FormState> {
  const patientId = field(form, "patientId");
  try {
    await addMembership(new Headers(await headers()), { patientId, policyId: field(form, "policyId"), policyNumber: field(form, "policyNumber"), validFrom: field(form, "validFrom"), validTo: field(form, "validTo") });
  } catch (error) { return failed(error); }
  registrationDone(patientId, "membership");
}
export async function encounterAction(_state: FormState, form: FormData): Promise<FormState> {
  const patientId = field(form, "patientId");
  const localTime = field(form, "admissionDate");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/u.test(localTime)) return { error: "Enter a valid admission date and time in IST." };
  const admissionDate = `${localTime.length === 16 ? `${localTime}:00` : localTime}+05:30`;
  try {
    await registerEncounter(new Headers(await headers()), { patientId, branchId: field(form, "branchId"), encounterType: field(form, "encounterType"), admissionDate });
  } catch (error) { return failed(error); }
  registrationDone(patientId, "encounter");
}
export async function caseAction(_state: FormState, form: FormData): Promise<FormState> {
  let id: string;
  try {
    id = (await createCase(new Headers(await headers()), { patientId: field(form, "patientId"), branchId: field(form, "branchId"), patientInsuranceId: field(form, "patientInsuranceId"), encounterId: field(form, "encounterId"), ownerId: field(form, "ownerId"), nextAction: field(form, "nextAction"), creationKey: field(form, "creationKey") })).id;
  } catch (error) { return failed(error); }
  revalidatePath("/desk");
  redirect(`/desk/cases/${id}`);
}
