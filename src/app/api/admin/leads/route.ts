import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isAdminEmail, parseAdminEmails } from "@/lib/admin";
import { db } from "@/lib/db";

/** Export CSV des emails récoltés (pour ton outil d'emailing). Réservé aux admins. */
export async function GET() {
  const user = await currentUser();
  if (!user || !isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS)))
    return new NextResponse("Not found", { status: 404 });
  const leads = await db.lead.findMany({ orderBy: { createdAt: "desc" } });
  // Guillemets doublés + neutralisation des formules Excel (=, +, -, @ en début de cellule).
  const esc = (v: string) => `"${(/^[=+\-@]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"`;
  const csv = ["email,source,ref_code,created_at", ...leads.map((l) => [esc(l.email), esc(l.source), esc(l.refCode ?? ""), l.createdAt.toISOString()].join(","))].join("\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="emails-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
