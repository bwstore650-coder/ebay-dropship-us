"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EU_COUNTRIES } from "@/lib/eu";

const schema = z.object({
  euRpCompany: z.string().trim().min(2).max(100),
  euRpAddress: z.string().trim().min(3).max(150),
  euRpCity: z.string().trim().min(1).max(80),
  euRpPostalCode: z.string().trim().min(2).max(12),
  euRpCountry: z.enum(EU_COUNTRIES),
  euRpEmail: z.string().trim().email().max(120),
});

/** Personne responsable dans l'UE (GPSR), affichée sur les annonces européennes. */
export async function saveGpsr(formData: FormData) {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(["euRpCompany", "euRpAddress", "euRpCity", "euRpPostalCode", "euRpCountry", "euRpEmail"].map((k) => [k, formData.get(k) ?? ""])));
  if (!parsed.success) redirect("/settings?gpsr=invalid#gpsr");
  await db.user.update({ where: { id: user.id }, data: parsed.data });
  revalidatePath("/settings");
  redirect("/settings?gpsr=saved#gpsr");
}

/** Active ou désactive la commande automatique chez le fournisseur. */
export async function setAutoOrder(formData: FormData) {
  const user = await requireUser();
  await db.user.update({ where: { id: user.id }, data: { autoOrder: formData.get("autoOrder") === "on" } });
  revalidatePath("/settings");
  revalidatePath("/orders");
}
