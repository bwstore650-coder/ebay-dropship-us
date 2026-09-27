"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { endListing } from "@/lib/listing-service";

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
