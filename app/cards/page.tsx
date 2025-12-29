"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// If this import fails, tell me what you see in: dir lib\supabase
import { createClient } from "@/lib/supabase/client";

type CardRow = {
  id: string;
  name: string;
  bank: string | null;
  credit_limit: number | null;
  currency: string | null;
  notes: string | null;
  created_at: string;
};

export default function CardsPage() {
  const supabase = createClient();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");

  async function loadAll() {
    setLoading(true);
    setMsg("");

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;

    if (!user) {
      setUserEmail(null);
      setCards([]);
      setLoading(false);
      return;
    }

    setUserEmail(user.email ?? "");

    const { data, error } = await supabase
      .from("cards")
      .select("id,name,bank,credit_limit,currency,notes,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      setMsg("Load error: " + error.message);
      setCards([]);
    } else {
      setCards((data ?? []) as CardRow[]);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

async function onAdd(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  setMsg("");

  const form =
    e.currentTarget instanceof HTMLFormElement
      ? e.currentTarget
      : ((e.target as HTMLElement).closest("form") as HTMLFormElement | null);

  if (!form) {
    setMsg("Form not found. Please refresh and try again.");
    return;
  }

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    setMsg("Please sign in first.");
    return;
  }

  const fd = new FormData(form);

  const name = String(fd.get("name") || "").trim();
  const bank = String(fd.get("bank") || "").trim() || null;
  const credit_limit = Number(String(fd.get("credit_limit") || "0").trim() || 0);
  const currency = String(fd.get("currency") || "AED").trim() || "AED";
  const notes = String(fd.get("notes") || "").trim() || null;

  if (!name) {
    setMsg("Card name is required.");
    return;
  }

  const { error } = await supabase.from("cards").insert({
    user_id: user.id,
    name,
    bank,
    credit_limit: Number.isFinite(credit_limit) ? credit_limit : 0,
    currency,
    notes,
  });

  if (error) {
    setMsg("Save error: " + error.message);
    return;
  }

  form.reset();
  await loadAll();
}

  async function onDelete(id: string) {
    setMsg("");

    const { error } = await supabase
      .from("cards")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      setMsg("Delete error: " + error.message);
      return;
    }

    await loadAll();
  }

  if (!userEmail) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Cards</h1>
        <p style={{ marginTop: 8 }}>Please sign in first.</p>
        <p style={{ marginTop: 8 }}>
          Go to <Link href="/">Home</Link> and sign in.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Cards</h1>
      <div style={{ marginTop: 6, opacity: 0.75 }}>Signed in as: {userEmail}</div>

      <div style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Add Card</h2>

        <form onSubmit={onAdd} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <input name="name" placeholder="Card name (required)" required />
          <input name="bank" placeholder="Bank (optional)" />
          <input name="credit_limit" placeholder="Credit limit (e.g., 5000)" inputMode="decimal" />
          <input name="currency" placeholder="Currency (default AED)" defaultValue="AED" />
          <input name="notes" placeholder="Notes (optional)" />
          <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999" }}>
            Save
          </button>
        </form>

        {msg ? <p style={{ marginTop: 10, color: msg.includes("error") ? "crimson" : "black" }}>{msg}</p> : null}
      </div>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Your Cards</h2>

        {loading ? (
          <p style={{ marginTop: 10 }}>Loading…</p>
        ) : cards.length === 0 ? (
          <p style={{ marginTop: 10 }}>No cards yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {cards.map((c) => (
              <div key={c.id} style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {c.name} {c.bank ? `• ${c.bank}` : ""}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Limit: {c.currency ?? "AED"} {Number(c.credit_limit ?? 0).toFixed(2)}
                    </div>
                    {c.notes ? <div style={{ marginTop: 6, opacity: 0.8 }}>{c.notes}</div> : null}
                  </div>

                  <button
                    onClick={() => onDelete(c.id)}
                    style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
