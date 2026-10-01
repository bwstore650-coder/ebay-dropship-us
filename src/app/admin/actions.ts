"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { COMP_INTERVAL } from "@/lib/admin";

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

/** Publie ou refuse un avis client. */
export async function moderateReview(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("reviewId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!id || (decision !== "APPROVED" && decision !== "REJECTED")) return;
  await db.review.update({
    where: { id },
    data: { status: decision, approvedAt: decision === "APPROVED" ? new Date() : null },
  });
  revalidatePath("/admin/reviews");
  revalidatePath("/");
}

/**
 * Accès offert (testeurs, relecteur du Chrome Web Store) : formule Pro gratuite, jamais comptée dans le revenu.
 * Refusé pour un client qui a un abonnement Stripe (on ne mélange pas abonnement payé et accès offert).
 */
export async function setCompAccess(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const on = formData.get("on") === "1";
  if (!userId) return;
  const u = await db.user.findUnique({ where: { id: userId }, select: { plan: true, billingInterval: true, stripeSubscriptionId: true } });
  if (!u) return;
  if (on && !u.stripeSubscriptionId && u.plan === "NONE") {
    await db.user.update({ where: { id: userId }, data: { plan: "PRO", billingInterval: COMP_INTERVAL } });
  }
  if (!on && u.billingInterval === COMP_INTERVAL) {
    await db.user.update({ where: { id: userId }, data: { plan: "NONE", billingInterval: null } });
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin");
}
