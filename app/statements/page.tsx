"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type CardRow = {
  id: string;
  name: string;
  bank: string | null;
  currency: string | null;
};

type StatementRow = {
  id: string;
  card_id: string;
  statement_month: string; // yyyy-mm-01
  statement_date: string | null;
  due_date: string | null;
  statement_amount: number | null;
  currency: string | null;
  created_at: string;
};

type PaymentRow = {
  id: string;
  statement_id: string | null;
  amount: number | null;
};

function monthStartISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function normalizeMonthStart(input: string) {
  const parts = input.split("-");
  if (parts.length >= 2) {
    const y = parts[0];
    const m = parts[1];
    if (y && m) return `${y}-${m}-01`;
  }
  return input;
}

export default function StatementsPage() {
  const supabase = createClient();

  const [userEmail, setUserEmail] = useState<string | null>(null);

  const [cards, setCards] = useState<CardRow[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>("");

  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");

  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) || null,
    [cards, selectedCardId]
  );

  const paidMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of payments) {
      if (!p.statement_id) continue;
      map.set(p.statement_id, (map.get(p.statement_id) ?? 0) + Number(p.amount ?? 0));
    }
    return map;
  }, [payments]);

  async function loadCards() {
    setMsg("");

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;

    if (!user) {
      setUserEmail(null);
      setCards([]);
      setSelectedCardId("");
      return null;
    }

    setUserEmail(user.email ?? "");

    const res = await supabase
      .from("cards")
      .select("id,name,bank,currency")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (res.error) {
      setMsg("Load cards error: " + res.error.message);
      setCards([]);
      return user;
    }

    const rows = (res.data ?? []) as CardRow[];
    setCards(rows);

    if (!selectedCardId && rows.length > 0) setSelectedCardId(rows[0].id);

    return user;
  }

  async function loadStatementsAndPayments(cardId: string) {
    setMsg("");

    if (!cardId) {
      setStatements([]);
      setPayments([]);
      return;
    }

    // 1) Load statements
    const st = await supabase
      .from("statements")
      .select("id,card_id,statement_month,statement_date,due_date,statement_amount,currency,created_at")
      .eq("card_id", cardId)
      .is("deleted_at", null)
      .order("statement_month", { ascending: false });

    if (st.error) {
      setMsg("Load statements error: " + st.error.message);
      setStatements([]);
      setPayments([]);
      return;
    }

    const stRows = (st.data ?? []) as StatementRow[];
    setStatements(stRows);

    // 2) Load payments by statement_id IN (statement ids)
    const ids = stRows.map((s) => s.id);
    if (ids.length === 0) {
      setPayments([]);
      return;
    }

    const pay = await supabase
      .from("payments")
      .select("id,statement_id,amount")
      .in("statement_id", ids)
      .is("deleted_at", null);

    if (pay.error) {
      setMsg("Load payments error: " + pay.error.message);
      setPayments([]);
      return;
    }

    setPayments((pay.data ?? []) as PaymentRow[]);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadCards();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedCardId) loadStatementsAndPayments(selectedCardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCardId]);

  async function onAddStatement(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("");

    const form =
      e.currentTarget instanceof HTMLFormElement
        ? e.currentTarget
        : ((e.target as HTMLElement).closest("form") as HTMLFormElement | null);

    if (!form) {
      setMsg("Form not found. Refresh and try again.");
      return;
    }

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      setMsg("Please sign in first.");
      return;
    }

    if (!selectedCardId) {
      setMsg("Please select a card first.");
      return;
    }

    const fd = new FormData(form);

    const statement_month_raw = String(fd.get("statement_month") || "").trim();
    const statement_month = normalizeMonthStart(statement_month_raw);

    const statement_date = String(fd.get("statement_date") || "").trim() || null;
    const due_date = String(fd.get("due_date") || "").trim() || null;

    const amount = Number(String(fd.get("statement_amount") || "0").trim() || 0);

    if (!statement_month) {
      setMsg("Statement month is required.");
      return;
    }

    const currency = selectedCard?.currency ?? "AED";

    // UPSERT: update if same (user_id, card_id, statement_month) exists
    const payload = {
      user_id: user.id,
      card_id: selectedCardId,
      statement_month,
      statement_date,
      due_date,
      statement_amount: Number.isFinite(amount) ? amount : 0,
      currency,
    };

    const { error } = await supabase
      .from("statements")
      .upsert(payload, { onConflict: "user_id,card_id,statement_month" });

    if (error) {
      setMsg("Save error: " + error.message);
      return;
    }

    setMsg("Saved (updated if month already exists).");
    form.reset();
    await loadStatementsAndPayments(selectedCardId);
  }

  if (!userEmail) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Statements</h1>
        <p style={{ marginTop: 8 }}>Please sign in first.</p>
        <p style={{ marginTop: 8 }}>
          Go to <Link href="/">Home</Link> and sign in.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Statements</h1>
      <div style={{ marginTop: 6, opacity: 0.75 }}>Signed in as: {userEmail}</div>

      <div style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>Select Card</div>

          <select value={selectedCardId} onChange={(e) => setSelectedCardId(e.target.value)}>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.bank ? ` - ${c.bank}` : ""}
              </option>
            ))}
          </select>

          <div style={{ marginLeft: "auto" }}>
            <Link href="/cards">Cards</Link> &nbsp;|&nbsp; <Link href="/payments">Payments</Link>
          </div>
        </div>

        <hr style={{ margin: "14px 0" }} />

        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Add / Update Statement</h2>

        <form onSubmit={onAddStatement} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>
            Statement month (stored as 1st day)
            <input name="statement_month" type="date" defaultValue={monthStartISO(new Date())} required />
          </label>

          <label>
            Statement date (optional)
            <input name="statement_date" type="date" />
          </label>

          <label>
            Due date (optional)
            <input name="due_date" type="date" />
          </label>

          <label>
            Statement amount
            <input name="statement_amount" placeholder="e.g., 1200" inputMode="decimal" />
          </label>

          <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999" }}>
            Save Statement
          </button>

          {msg ? (
            <div style={{ color: msg.toLowerCase().includes("error") ? "crimson" : "black" }}>{msg}</div>
          ) : null}
        </form>
      </div>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Statements List</h2>

        {loading ? (
          <p style={{ marginTop: 10 }}>Loading…</p>
        ) : statements.length === 0 ? (
          <p style={{ marginTop: 10 }}>No statements yet for this card.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {statements.map((s) => {
              const amount = Number(s.statement_amount ?? 0);
              const paid = paidMap.get(s.id) ?? 0;
              const pending = amount - paid;

              return (
                <div key={s.id} style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
                  <div style={{ fontWeight: 700 }}>Month: {s.statement_month}</div>

                  <div style={{ marginTop: 6 }}>
                    Amount: {s.currency ?? "AED"} {amount.toFixed(2)}
                  </div>

                  <div style={{ marginTop: 6 }}>
                    Paid: {s.currency ?? "AED"} {paid.toFixed(2)}
                  </div>

                  <div style={{ marginTop: 6, fontWeight: 700 }}>
                    Pending: {s.currency ?? "AED"} {pending.toFixed(2)}
                  </div>

                  <div style={{ marginTop: 6, opacity: 0.85 }}>
                    Due: {s.due_date ?? "-"} | Statement Date: {s.statement_date ?? "-"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
