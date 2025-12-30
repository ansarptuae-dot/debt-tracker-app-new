"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Tab = "OVERVIEW" | "CARDS" | "STATEMENTS" | "PAYMENTS";

type CardRow = {
  id: string;
  user_id: string;
  name: string;
  bank: string | null;
  credit_limit: number | null;
  currency: string | null;
  notes: string | null;
  created_at?: string;
};

type StatementRow = {
  id: string;
  user_id: string;
  card_id: string;
  statement_month: string; // YYYY-MM-01
  statement_date: string | null;
  due_date: string | null;
  statement_amount: number | null;
  currency: string | null;
  created_at?: string;
};

type PaymentRow = {
  id: string;
  user_id: string;
  kind: string; // "CARD" etc
  card_id: string | null;
  statement_id: string | null;
  payment_date: string; // YYYY-MM-DD
  amount: number | null;
  currency: string | null;
  note: string | null;
  created_at?: string;
};

function isoToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function firstDayOfMonth(dateStr: string): string | null {
  // dateStr is YYYY-MM-DD
  if (!dateStr || dateStr.length < 10) return null;
  const y = dateStr.slice(0, 4);
  const m = dateStr.slice(5, 7);
  if (!y || !m) return null;
  return `${y}-${m}-01`;
}

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const [mountedToday, setMountedToday] = useState<string>(""); // avoid new Date() during prerender

  const [userEmail, setUserEmail] = useState<string>("");

  const [cards, setCards] = useState<CardRow[]>([]);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  // ------- Cards form -------
  const [cardName, setCardName] = useState("");
  const [cardBank, setCardBank] = useState("");
  const [cardLimit, setCardLimit] = useState("");
  const [cardCurrency, setCardCurrency] = useState("AED");
  const [cardNotes, setCardNotes] = useState("");

  // ------- Statements form -------
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [editingStatementId, setEditingStatementId] = useState<string>("");
  const [stMonth, setStMonth] = useState<string>(""); // date input
  const [stDate, setStDate] = useState<string>(""); // optional
  const [stDue, setStDue] = useState<string>(""); // optional
  const [stAmount, setStAmount] = useState<string>(""); // number string

  // ------- Payments form -------
  const [editingPaymentId, setEditingPaymentId] = useState<string>("");
  const [payCardId, setPayCardId] = useState<string>("");
  const [payStatementId, setPayStatementId] = useState<string>(""); // optional
  const [payDate, setPayDate] = useState<string>(""); // required
  const [payAmount, setPayAmount] = useState<string>("");
  const [payNote, setPayNote] = useState<string>("");

  useEffect(() => {
    // only runs in browser
    const t = isoToday();
    setMountedToday(t);
    setPayDate(t);
    // default statement month to current month first day
    setStMonth(firstDayOfMonth(t) ?? "");
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    setMsg("");

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      setUserEmail("");
      setLoading(false);
      setMsg("Auth error: " + userErr.message);
      return;
    }

    const user = userRes?.user;
    if (!user) {
      setUserEmail("");
      setLoading(false);
      return;
    }

    setUserEmail(user.email ?? "");

    const [cardsRes, statementsRes, paymentsRes] = await Promise.all([
      supabase.from("cards").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("statements").select("*").eq("user_id", user.id).order("statement_month", { ascending: false }),
      supabase.from("payments").select("*").eq("user_id", user.id).order("payment_date", { ascending: false }).limit(50),
    ]);

    if (cardsRes.error) setMsg("Load cards error: " + cardsRes.error.message);
    if (statementsRes.error) setMsg("Load statements error: " + statementsRes.error.message);
    if (paymentsRes.error) setMsg("Load payments error: " + paymentsRes.error.message);

    setCards((cardsRes.data as CardRow[]) ?? []);
    setStatements((statementsRes.data as StatementRow[]) ?? []);
    setPayments((paymentsRes.data as PaymentRow[]) ?? []);

    setLoading(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  }

  // ---------------- Derived maps ----------------
  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const statementsByCard = useMemo(() => {
    const m = new Map<string, StatementRow[]>();
    for (const s of statements) {
      const arr = m.get(s.card_id) ?? [];
      arr.push(s);
      m.set(s.card_id, arr);
    }
    // keep newest first
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => (a.statement_month < b.statement_month ? 1 : -1));
      m.set(k, arr);
    }
    return m;
  }, [statements]);

  const paidByStatement = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      if (!p.statement_id) continue;
      const amt = Number(p.amount ?? 0);
      if (!Number.isFinite(amt)) continue;
      m.set(p.statement_id, (m.get(p.statement_id) ?? 0) + amt);
    }
    return m;
  }, [payments]);

  const pendingByCard = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of statements) {
      const amount = Number(s.statement_amount ?? 0);
      const paid = paidByStatement.get(s.id) ?? 0;
      const pending = amount - paid;
      m.set(s.card_id, (m.get(s.card_id) ?? 0) + pending);
    }
    return m;
  }, [statements, paidByStatement]);

  const totalLimit = useMemo(() => cards.reduce((sum, c) => sum + Number(c.credit_limit ?? 0), 0), [cards]);

  const totalPending = useMemo(() => {
    let sum = 0;
    for (const s of statements) {
      const amount = Number(s.statement_amount ?? 0);
      const paid = paidByStatement.get(s.id) ?? 0;
      sum += amount - paid;
    }
    return sum;
  }, [statements, paidByStatement]);

  const upcomingDue = useMemo(() => {
    // no current-time call here; uses mountedToday (set in useEffect)
    if (!mountedToday) return [];
    const today = new Date(mountedToday + "T00:00:00");
    const in30 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);

    const list: Array<
      StatementRow & {
        pending: number;
        days: number;
      }
    > = [];

    for (const s of statements) {
      if (!s.due_date) continue;
      const due = new Date(s.due_date + "T00:00:00");
      if (Number.isNaN(due.getTime())) continue;

      const amount = Number(s.statement_amount ?? 0);
      const paid = paidByStatement.get(s.id) ?? 0;
      const pending = amount - paid;
      if (pending <= 0) continue;

      if (due >= today && due <= in30) {
        const days = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        list.push({ ...s, pending, days });
      }
    }

    list.sort((a, b) => (a.due_date! > b.due_date! ? 1 : -1));
    return list;
  }, [mountedToday, statements, paidByStatement]);

  // ---------------- Actions: Cards ----------------
  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!cardName.trim()) {
      setMsg("Card name is required.");
      return;
    }

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      setMsg("Please sign in first.");
      return;
    }

    const limit = Number(cardLimit || 0);

    const { error } = await supabase.from("cards").insert({
      user_id: user.id,
      name: cardName.trim(),
      bank: cardBank.trim() ? cardBank.trim() : null,
      credit_limit: Number.isFinite(limit) ? limit : 0,
      currency: cardCurrency.trim() || "AED",
      notes: cardNotes.trim() ? cardNotes.trim() : null,
    });

    if (error) {
      setMsg("Save card error: " + error.message);
      return;
    }

    setCardName("");
    setCardBank("");
    setCardLimit("");
    setCardCurrency("AED");
    setCardNotes("");
    await loadAll();
    setTab("CARDS");
  }

  async function deleteCard(cardId: string) {
    setMsg("");
    // note: may fail if statements reference card (FK). This is okay; show error.
    const { error } = await supabase.from("cards").delete().eq("id", cardId);
    if (error) {
      setMsg("Delete card error: " + error.message);
      return;
    }
    await loadAll();
  }

  // ---------------- Actions: Statements ----------------
  function resetStatementForm() {
    setEditingStatementId("");
    setStDate("");
    setStDue("");
    setStAmount("");
    if (mountedToday) setStMonth(firstDayOfMonth(mountedToday) ?? "");
  }

  function startEditStatement(s: StatementRow) {
    setTab("STATEMENTS");
    setEditingStatementId(s.id);
    setSelectedCardId(s.card_id);
    setStMonth(s.statement_month ?? "");
    setStDate(s.statement_date ?? "");
    setStDue(s.due_date ?? "");
    setStAmount(String(s.statement_amount ?? ""));
  }

  async function saveStatement(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      setMsg("Please sign in first.");
      return;
    }

    if (!selectedCardId) {
      setMsg("Select a card first.");
      return;
    }

    const month = firstDayOfMonth(stMonth);
    if (!month) {
      setMsg("Statement month is required.");
      return;
    }

    const amount = Number(stAmount || 0);
    const card = cardMap.get(selectedCardId);
    const currency = (card?.currency ?? "AED") as string;

    if (editingStatementId) {
      const { error } = await supabase
        .from("statements")
        .update({
          statement_month: month,
          statement_date: stDate || null,
          due_date: stDue || null,
          statement_amount: Number.isFinite(amount) ? amount : 0,
          currency,
        })
        .eq("id", editingStatementId);

      if (error) {
        setMsg("Update statement error: " + error.message);
        return;
      }
    } else {
      // IMPORTANT: upsert to avoid duplicate month error
      const { error } = await supabase.from("statements").upsert(
        {
          user_id: user.id,
          card_id: selectedCardId,
          statement_month: month,
          statement_date: stDate || null,
          due_date: stDue || null,
          statement_amount: Number.isFinite(amount) ? amount : 0,
          currency,
        },
        { onConflict: "user_id,card_id,statement_month" }
      );

      if (error) {
        setMsg("Save statement error: " + error.message);
        return;
      }
    }

    resetStatementForm();
    await loadAll();
    setTab("STATEMENTS");
  }

  async function deleteStatement(statementId: string) {
    setMsg("");
    // unlink payments first to avoid FK issues
    const unlink = await supabase.from("payments").update({ statement_id: null }).eq("statement_id", statementId);
    if (unlink.error) {
      setMsg("Unlink payments error: " + unlink.error.message);
      return;
    }

    const del = await supabase.from("statements").delete().eq("id", statementId);
    if (del.error) {
      setMsg("Delete statement error: " + del.error.message);
      return;
    }

    await loadAll();
  }

  // ---------------- Actions: Payments ----------------
  function resetPaymentForm() {
    setEditingPaymentId("");
    setPayCardId("");
    setPayStatementId("");
    setPayAmount("");
    setPayNote("");
    if (mountedToday) setPayDate(mountedToday);
  }

  function startEditPayment(p: PaymentRow) {
    setTab("PAYMENTS");
    setEditingPaymentId(p.id);
    setPayCardId(p.card_id ?? "");
    setPayStatementId(p.statement_id ?? "");
    setPayDate(p.payment_date ?? (mountedToday || ""));
    setPayAmount(String(p.amount ?? ""));
    setPayNote(p.note ?? "");
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      setMsg("Please sign in first.");
      return;
    }

    if (!payCardId) {
      setMsg("Select a card.");
      return;
    }
    if (!payDate) {
      setMsg("Payment date is required.");
      return;
    }

    const amount = Number(payAmount || 0);
    const card = cardMap.get(payCardId);
    const currency = (card?.currency ?? "AED") as string;

    if (editingPaymentId) {
      const { error } = await supabase
        .from("payments")
        .update({
          kind: "CARD",
          card_id: payCardId,
          statement_id: payStatementId || null,
          payment_date: payDate,
          amount: Number.isFinite(amount) ? amount : 0,
          currency,
          note: payNote.trim() ? payNote.trim() : null,
        })
        .eq("id", editingPaymentId);

      if (error) {
        setMsg("Update payment error: " + error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("payments").insert({
        user_id: user.id,
        kind: "CARD",
        card_id: payCardId,
        statement_id: payStatementId || null,
        payment_date: payDate,
        amount: Number.isFinite(amount) ? amount : 0,
        currency,
        note: payNote.trim() ? payNote.trim() : null,
      });

      if (error) {
        setMsg("Save payment error: " + error.message);
        return;
      }
    }

    resetPaymentForm();
    await loadAll();
    setTab("PAYMENTS");
  }

  async function deletePayment(paymentId: string) {
    setMsg("");
    const { error } = await supabase.from("payments").delete().eq("id", paymentId);
    if (error) {
      setMsg("Delete payment error: " + error.message);
      return;
    }
    await loadAll();
  }

  async function updatePaymentStatement(paymentId: string, statementId: string) {
    setMsg("");
    const { error } = await supabase
      .from("payments")
      .update({ statement_id: statementId || null })
      .eq("id", paymentId);

    if (error) {
      setMsg("Update payment link error: " + error.message);
      return;
    }

    await loadAll();
  }

  // ---------------- UI ----------------
  if (!userEmail) {
    return (
      <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Debt Tracker</h1>
        <p style={{ marginTop: 10 }}>Please sign in first.</p>
        <div style={{ marginTop: 10 }}>
          <Link href="/auth/login">Login</Link> &nbsp;|&nbsp; <Link href="/auth/sign-up">Sign up</Link>
        </div>
      </div>
    );
  }

  const cardStatements = selectedCardId ? statementsByCard.get(selectedCardId) ?? [] : [];
  const paymentStatementOptions = payCardId ? statementsByCard.get(payCardId) ?? [] : [];

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Debt Tracker</h1>
        <div style={{ opacity: 0.75 }}>Signed in as: {userEmail}</div>
        <button
          onClick={signOut}
          style={{ marginLeft: "auto", padding: "8px 12px", borderRadius: 10, border: "1px solid #999" }}
        >
          Logout
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["OVERVIEW", "CARDS", "STATEMENTS", "PAYMENTS"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid #ccc",
              fontWeight: 700,
              background: tab === t ? "#eee" : "white",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {msg ? (
        <div style={{ marginTop: 10, color: msg.toLowerCase().includes("error") ? "crimson" : "black" }}>{msg}</div>
      ) : null}

      {/* ---------------- OVERVIEW ---------------- */}
      {tab === "OVERVIEW" ? (
        <>
          <div
            style={{
              marginTop: 16,
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ opacity: 0.8 }}>Total Cards</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>{cards.length}</div>
            </div>

            <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ opacity: 0.8 }}>Total Limit</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>AED {totalLimit.toFixed(2)}</div>
            </div>

            <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ opacity: 0.8 }}>Total Pending</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>AED {totalPending.toFixed(2)}</div>
            </div>
          </div>

          <div style={{ marginTop: 16, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 900 }}>Upcoming Due (Next 30 Days)</div>

            {loading ? (
              <p style={{ marginTop: 10 }}>Loading…</p>
            ) : upcomingDue.length === 0 ? (
              <p style={{ marginTop: 10 }}>No due dates in the next 30 days.</p>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {upcomingDue.map((s) => {
                  const card = cardMap.get(s.card_id);
                  const label = card ? `${card.name}${card.bank ? " - " + card.bank : ""}` : s.card_id;

                  return (
                    <div key={s.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                      <div style={{ fontWeight: 900 }}>
                        {label} • Due {s.due_date} ({s.days} days)
                      </div>
                      <div style={{ marginTop: 6 }}>
                        Pending: {s.currency ?? "AED"} {Number(s.pending ?? 0).toFixed(2)}
                      </div>
                      <div style={{ marginTop: 6, opacity: 0.8 }}>Statement month: {s.statement_month}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* ---------------- CARDS ---------------- */}
      {tab === "CARDS" ? (
        <div style={{ marginTop: 16, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Cards</div>

          <form onSubmit={addCard} style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <label>
              Card name (required)
              <input value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="e.g., RAK BANK" required />
            </label>

            <label>
              Bank (optional)
              <input value={cardBank} onChange={(e) => setCardBank(e.target.value)} placeholder="e.g., RAK" />
            </label>

            <label>
              Credit limit
              <input value={cardLimit} onChange={(e) => setCardLimit(e.target.value)} placeholder="e.g., 6000" inputMode="decimal" />
            </label>

            <label>
              Currency
              <input value={cardCurrency} onChange={(e) => setCardCurrency(e.target.value)} />
            </label>

            <label>
              Notes (optional)
              <input value={cardNotes} onChange={(e) => setCardNotes(e.target.value)} placeholder="any notes" />
            </label>

            <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999" }}>
              Save Card
            </button>
          </form>

          <div style={{ marginTop: 16, fontWeight: 900 }}>Your Cards</div>

          {loading ? (
            <p style={{ marginTop: 10 }}>Loading…</p>
          ) : cards.length === 0 ? (
            <p style={{ marginTop: 10 }}>No cards yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {cards.map((c) => {
                const pending = pendingByCard.get(c.id) ?? 0;
                return (
                  <div key={c.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900 }}>
                        {c.name} {c.bank ? `• ${c.bank}` : ""}
                      </div>

                      <button
                        type="button"
                        onClick={() => deleteCard(c.id)}
                        style={{ marginLeft: "auto", padding: "8px 10px", borderRadius: 10, border: "1px solid #999" }}
                      >
                        Delete
                      </button>
                    </div>

                    <div style={{ marginTop: 6 }}>
                      Limit: {c.currency ?? "AED"} {Number(c.credit_limit ?? 0).toFixed(2)}
                    </div>

                    <div style={{ marginTop: 6, fontWeight: 800 }}>
                      Pending: {c.currency ?? "AED"} {pending.toFixed(2)}
                    </div>

                    {c.notes ? <div style={{ marginTop: 6, opacity: 0.8 }}>{c.notes}</div> : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* ---------------- STATEMENTS ---------------- */}
      {tab === "STATEMENTS" ? (
        <div style={{ marginTop: 16, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Statements</div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>Select Card</div>
            <select value={selectedCardId} onChange={(e) => setSelectedCardId(e.target.value)}>
              <option value="">Select</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.bank ? ` - ${c.bank}` : ""}
                </option>
              ))}
            </select>
          </div>

          <form onSubmit={saveStatement} style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <div style={{ fontWeight: 900 }}>{editingStatementId ? "Edit Statement" : "Add / Update Statement"}</div>

            <label>
              Statement month (stored as 1st day)
              <input value={stMonth} onChange={(e) => setStMonth(e.target.value)} type="date" required />
            </label>

            <label>
              Statement date (optional)
              <input value={stDate} onChange={(e) => setStDate(e.target.value)} type="date" />
            </label>

            <label>
              Due date (optional)
              <input value={stDue} onChange={(e) => setStDue(e.target.value)} type="date" />
            </label>

            <label>
              Statement amount
              <input value={stAmount} onChange={(e) => setStAmount(e.target.value)} placeholder="e.g., 1200" inputMode="decimal" />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999" }}>
                {editingStatementId ? "Update Statement" : "Save Statement"}
              </button>

              {editingStatementId ? (
                <button
                  type="button"
                  onClick={resetStatementForm}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999" }}
                >
                  Cancel Edit
                </button>
              ) : null}
            </div>
          </form>

          <div style={{ marginTop: 16, fontWeight: 900 }}>Statements List</div>

          {loading ? (
            <p style={{ marginTop: 10 }}>Loading…</p>
          ) : !selectedCardId ? (
            <p style={{ marginTop: 10 }}>Select a card to see its statements.</p>
          ) : cardStatements.length === 0 ? (
            <p style={{ marginTop: 10 }}>No statements for this card.</p>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {cardStatements.map((s) => {
                const amount = Number(s.statement_amount ?? 0);
                const paid = paidByStatement.get(s.id) ?? 0;
                const pending = amount - paid;

                return (
                  <div key={s.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 900 }}>Month: {s.statement_month}</div>

                    <div style={{ marginTop: 6 }}>
                      Amount: {s.currency ?? "AED"} {amount.toFixed(2)}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      Paid: {s.currency ?? "AED"} {paid.toFixed(2)}
                    </div>
                    <div style={{ marginTop: 6, fontWeight: 900 }}>
                      Pending: {s.currency ?? "AED"} {pending.toFixed(2)}
                    </div>

                    <div style={{ marginTop: 6, opacity: 0.8 }}>
                      Due: {s.due_date ?? "-"} | Statement Date: {s.statement_date ?? "-"}
                    </div>

                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => startEditStatement(s)}
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999" }}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteStatement(s.id)}
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* ---------------- PAYMENTS ---------------- */}
      {tab === "PAYMENTS" ? (
        <div style={{ marginTop: 16, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Payments (Card)</div>

          <form onSubmit={savePayment} style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <div style={{ fontWeight: 900 }}>{editingPaymentId ? "Edit Payment" : "Add Payment"}</div>

            <label>
              Card
              <select
                value={payCardId}
                onChange={(e) => {
                  setPayCardId(e.target.value);
                  setPayStatementId("");
                }}
                required
              >
                <option value="">Select</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.bank ? ` - ${c.bank}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Statement (recommended)
              <select value={payStatementId} onChange={(e) => setPayStatementId(e.target.value)}>
                <option value="">None</option>
                {paymentStatementOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.statement_month}
                    {s.due_date ? ` (Due ${s.due_date})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Payment date
              <input value={payDate} onChange={(e) => setPayDate(e.target.value)} type="date" required />
            </label>

            <label>
              Amount
              <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="e.g., 500" inputMode="decimal" />
            </label>

            <label>
              Note (optional)
              <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g., cash payment" />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999" }}>
                {editingPaymentId ? "Update Payment" : "Save Payment"}
              </button>

              {editingPaymentId ? (
                <button
                  type="button"
                  onClick={resetPaymentForm}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999" }}
                >
                  Cancel Edit
                </button>
              ) : null}
            </div>
          </form>

          <div style={{ marginTop: 16, fontWeight: 900 }}>Latest Payments (last 50)</div>

          {loading ? (
            <p style={{ marginTop: 10 }}>Loading…</p>
          ) : payments.length === 0 ? (
            <p style={{ marginTop: 10 }}>No payments yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {payments.map((p) => {
                const card = p.card_id ? cardMap.get(p.card_id) : null;
                const options = p.card_id ? statementsByCard.get(p.card_id) ?? [] : [];

                return (
                  <div key={p.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 900 }}>
                      {p.kind} • {p.payment_date}
                      {card ? ` • ${card.name}${card.bank ? " - " + card.bank : ""}` : ""}
                    </div>

                    <div style={{ marginTop: 6 }}>
                      Amount: {p.currency ?? "AED"} {Number(p.amount ?? 0).toFixed(2)}
                    </div>

                    {p.note ? <div style={{ marginTop: 6, opacity: 0.8 }}>{p.note}</div> : null}

                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 13, opacity: 0.8 }}>Linked statement (affects Paid/Pending):</div>
                      <select
                        value={p.statement_id ?? ""}
                        onChange={(e) => updatePaymentStatement(p.id, e.target.value)}
                        style={{ marginTop: 6 }}
                      >
                        <option value="">None</option>
                        {options.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.statement_month}
                            {s.due_date ? ` (Due ${s.due_date})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => startEditPayment(p)}
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999" }}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => deletePayment(p.id)}
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <div style={{ marginTop: 18, opacity: 0.65, fontSize: 12 }}>
        Tip: For mobile, deploy on Vercel, then open the Vercel URL on Safari and “Add to Home Screen”.
      </div>
    </div>
  );
}
