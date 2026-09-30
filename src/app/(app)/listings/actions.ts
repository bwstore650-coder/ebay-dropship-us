"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { deleteDraft, endListing } from "@/lib/listing-service";
import { monitorUser } from "@/lib/monitor-service";

export async function endListingAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("listingId") ?? "");
  if (!id) return;
  try {
    await endListing(user, id);
  } catch (e) {
    console.error("Retrait annonce", e);
  }
  revalidatePath("/listings");
}

export async function deleteDraftAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("listingId") ?? "");
  if (!id) return;
  await deleteDraft(user, id);
  revalidatePath("/listings");
}

/** Vérifier maintenant le stock et les prix des annonces de ce vendeur. */
export async function checkNowAction() {
  const user = await requireUser();
  try {
    // Toutes les annonces, même vérifiées il y a moins d'une heure.
    await monitorUser(user, { force: true });
  } catch (e) {
    console.error("Vérification annonces", e);
  }
  revalidatePath("/listings");
}
