"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function addCard(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const bank = String(formData.get("bank") || "").trim() || null;
  const creditLimitRaw = String(formData.get("credit_limit") || "0").trim();
  const currency = String(formData.get("currency") || "AED").trim() || "AED";
  const notes = String(formData.get("notes") || "").trim() || null;

  const credit_limit = Number(creditLimitRaw);
  if (!name) throw new Error("Card name is required");

  const supabase = await createClient();
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) throw new Error("Not authenticated");

  const { error } = await supabase.from("cards").insert({
    user_id: userRes.user.id,
    name,
    bank,
    credit_limit: Number.isFinite(credit_limit) ? credit_limit : 0,
    currency,
    notes,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/cards");
}

export async function deleteCard(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  if (!id) throw new Error("Missing id");

  const supabase = await createClient();
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) throw new Error("Not authenticated");

  // Soft delete (recommended)
  const { error } = await supabase
    .from("cards")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/cards");
}
