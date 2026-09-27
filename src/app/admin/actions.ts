"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

/** Marque comme versées toutes les commissions disponibles d'un affilié (après l'avoir payé par PayPal / virement). */
export async function markAffiliatePaid(formData: FormData) {
  await requireAdmin();
  const affiliateId = String(formData.get("affiliateId") ?? "");
  if (!affiliateId) return;
  const now = new Date();
  await db.commission.updateMany({
    where: {
      affiliateId,
      OR: [{ status: "PAYABLE" }, { status: "PENDING", availableAt: { lte: now } }],
    },
    data: { status: "PAID", paidAt: now },
  });
  revalidatePath("/admin/affiliates");
  revalidatePath("/admin");
}

/** Annule une commission (client remboursé, fraude). */
export async function voidCommission(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("commissionId") ?? "");
  if (!id) return;
  await db.commission.updateMany({ where: { id, status: { in: ["PENDING", "PAYABLE"] } }, data: { status: "VOID" } });
  revalidatePath("/admin/affiliates");
  revalidatePath("/admin");
}
