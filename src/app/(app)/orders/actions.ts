"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { placeOrder, runForUser } from "@/lib/order-service";

/** Synchroniser maintenant : nouvelles ventes, commandes et suivis de ce vendeur. */
export async function syncNow() {
  const user = await requireUser();
  try {
    await runForUser(user);
  } catch (e) {
    console.error("Synchro commandes", e);
  }
  revalidatePath("/orders");
}

/** Commander quand même (perte acceptée, nouvel essai après un échec). */
export async function forceOrder(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("orderId") ?? "");
  if (id) await placeOrder(user, id, { force: true });
  revalidatePath("/orders");
}

/** Le vendeur a traité la commande lui-même (commandée à la main ou annulée sur eBay). */
export async function markHandled(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("orderId") ?? "");
  if (id)
    await db.order.updateMany({
      where: { id, userId: user.id, status: { in: ["PENDING", "NEEDS_REVIEW", "FAILED"] } },
      data: { status: "CANCELLED", errorCode: "HANDLED_MANUALLY", errorMessage: null },
    });
  revalidatePath("/orders");
}
