"use client";
import { useState } from "react";
import type { GenerateInput } from "@/lib/ai-service";

export interface AiUsage { used: number; limit: number; unlimited: boolean }

/** Appel à /api/ai/generate avec état « en cours », erreur et quota à jour. */
export function useAiGenerate(initialUsage: AiUsage | null) {
  const [busy, setBusy] = useState<"titles" | "description" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(initialUsage);

  async function run<K extends GenerateInput["kind"]>(kind: K, context: GenerateInput["context"]) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, context }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "AI_FAILED");
        return null;
      }
      if (data.usage) setUsage(data.usage);
      return data as K extends "titles" ? { titles: string[] } : { descriptionHtml: string };
    } catch {
      setError("AI_FAILED");
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, usage, run, setUsage };
}
