"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AfterSaleError, acceptReturn, approveCancel, cancelSupplier, syncAfterSales } from "@/lib/aftersale-service";

async function run(formData: FormData, fn: typeof approveCancel) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  let error: string | null = null;
  try {
    await fn(user, id);
  } catch (e) {
    error = e instanceof AfterSaleError && e.code === "SUPPLIER_MANUAL" ? "manual" : "refused";
    if (!(e instanceof AfterSaleError)) console.error("Retours", id, e);
  }
  revalidatePath("/returns");
  redirect(error ? `/returns?error=${error}` : "/returns");
}

export async function approveCancelAction(formData: FormData) {
  await run(formData, approveCancel);
}
export async function acceptReturnAction(formData: FormData) {
  await run(formData, acceptReturn);
}
export async function cancelSupplierAction(formData: FormData) {
  await run(formData, cancelSupplier);
}

/** Relevé immédiat (sinon automatique toutes les heures). */
export async function syncReturnsAction() {
  const user = await requireUser();
  await syncAfterSales(user).catch((e) => console.error("Retours", e));
  revalidatePath("/returns");
  redirect("/returns");
}
