"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
};

type StatementRow = {
  id: string;
  user_id: string;
  card_id: string;
  statement_month: string; // YYYY-MM-DD
  statement_date: string | null; // YYYY-MM-DD
  due_date: string | null; // YYYY-MM-DD
  statement_amount: number | null;
  currency: string | null;
};

type PaymentRow = {
  id: string;
  user_id: string;
  kind: string; // "CARD"
  card_id: string | null;
  statement_id: string | null;
  payment_date: string; // YYYY-MM-DD
  amount: number | null;
  currency: string | null;
  note: string | null;
};

function monthFirstDay(input: string) {
  // Convert any YYYY-MM-DD to YYYY-MM-01 without using new Date() in render.
  if (!input || input.length < 7) return input;
  const y = input.slice(0, 4);
  const m = input.slice(5, 7);
  return `${y}-${m}-01`;
}

export default function DashboardPage() {
  // Create Supabase only after mount (avoids build-time execution issues)
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      supabaseRef.current = createClient();
      setMounted(true);
    } catch (e: any) {
      console.error(e);
      setMounted(true);
    }
  }, []);

  const supabase = supabaseRef.current;

  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const [userId, setUserId] = useState<string>("");
  const [userEmail, setUserEmail] = useState<string>("");

  const [cards, setCards] = useState<CardRow[]>([]);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  // CARDS form
  const [cardName, setCardName] = useState("");
  const [cardBank, setCardBank] = useState("");
  const [cardLimit, setCardLimit] = useState("");
  const [cardCurrency, setCardCurrency] = useState("AED");
  const [cardNotes, setCardNotes] = useState("");

  // STATEMENTS form
  const [selectedCardId, setSelectedCardId] = useState("");
  const [editingStatementId, setEditingStatementId] = useState<string>("");
  const [stMonth, setStMonth] = useState(""); // YYYY-MM-DD (we store as YYYY-MM-01)
  const [stDate, setStDate] = useState("");
  const [stDue, setStDue] = useState("");
  const [stAmount, setStAmount] = useState("");

  // PAYMENTS form
  const [editingPaymentId, setEditingPaymentId] = useState<string>("");
  const [payCardId, setPayCardId] = useState<string>("");
  const [payStatementId, setPayStatementId] = useState<string>("");
  const [payDate, setPayDate] = useState<string>("");
  const [payAmount, setPayAmount] = useState<string>("");
  const [payNote, setPayNote] = useState<string>("");

  // Set today date only after mount (safe for Next prerender rules)
  useEffect(() => {
    if (!payDate) {
      const now = new Date();
      const yyyy = String(now.getFullYear());
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      setPayDate(`${yyyy}-${mm}-${dd}`);
    }
  }, [payDate]);

  async function loadAll() {
    if (!supabase) return;
    setLoading(true);
    setMsg("");

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      setMsg("Auth error: " + userErr.message);
      setLoading(false);
      return;
    }
    const user = userRes?.user;
    if (!user) {
      setUserId("");
      setUserEmail("");
      setLoading(false);
      return;
    }

    setUserId(user.id);
    setUserEmail(user.email ?? "");

    const [cardsRes, stRes, payRes] = await Promise.all([
      supabase.from("cards").select("*").eq("user_id", user.id).order("name"),
      supabase.from("statements").select("*").eq("user_id", user.id).order("statement_month", { ascending: false }),
      supabase.from("payments").select("*").eq("user_id", user.id).order("payment_date", { ascending: false }).limit(50),
    ]);

    if (cardsRes.error) setMsg("Load cards error: " + cardsRes.error.message);
    if (stRes.error) setMsg("Load statements error: " + stRes.error.message);
    if (payRes.error) setMsg("Load payments error: " + payRes.error.message);

    setCards((cardsRes.data ?? []) as any);
    setStatements((stRes.data ?? []) as any);
    setPayments((payRes.data ?? []) as any);

    setLoading(false);
  }

  useEffect(() => {
    if (!mounted) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  }

  // ---------- COMPUTED MAPS ----------
  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const statementsByCard = useMemo(() => {
    const m = new Map<string, StatementRow[]>();
    for (const s of statements) {
      const arr = m.get(s.card_id) ?? [];
      arr.push(s);
      m.set(s.card_id, arr);
    }
    return m;
  }, [statements]);

  const paidMap = useMemo(() => {
    const m = new Map<string, number>(); // statement_id -> paid sum
    for (const p of payments) {
      if (!p.statement_id) continue;
      const prev = m.get(p.statement_id) ?? 0;
      m.set(p.statement_id, prev + Number(p.amount ?? 0));
    }
    return m;
  }, [payments]);

  const pendingByCard = useMemo(() => {
    const m = new Map<string, number>(); // card_id -> pending sum (statement_amount - paid)
    for (const s of statements) {
      const amount = Number(s.statement_amount ?? 0);
      const paid = paidMap.get(s.id) ?? 0;
      const pending = Math.max(0, amount - paid);
      const prev = m.get(s.card_id) ?? 0;
      m.set(s.card_id, prev + pending);
    }
    return m;
  }, [statements, paidMap]);

  const totalLimit = useMemo(() => cards.reduce((a, c) => a + Number(c.credit_limit ?? 0), 0), [cards]);
  const totalPending = useMemo(() => {
    let t = 0;
    for (const v of pendingByCard.values()) t += v;
    return t;
  }, [pendingByCard]);

  const upcomingDue = useMemo(() => {
    // This uses Date only with fixed inputs (no new Date() here).
    // We also guard if due_date is missing.
    const today = new Date(); // this runs on client only after mount anyway, but keep safe:
    // NOTE: this memo runs during render; to avoid prerender issues, only compute if mounted.
    if (!mounted) return [];

    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const end = start + 30 * 24 * 60 * 60 * 1000;

    const list: Array<{ id: string; card_id: string; due_date: string; statement_month: string; pending: number; days: number; currency: string }> =
      [];

    for (const s of statements) {
      if (!s.due_date) continue;
      const dueT = Date.parse(s.due_date);
      if (!Number.isFinite(dueT)) continue;
      if (dueT < start || dueT > end) continue;

      const amount = Number(s.statement_amount ?? 0);
      const paid = paidMap.get(s.id) ?? 0;
      const pending = Math.max(0, amount - paid);
      const days = Math.round((dueT - start) / (24 * 60 * 60 * 1000));

      list.push({
        id: s.id,
        card_id: s.card_id,
        due_date: s.due_date,
        statement_month: s.statement_month,
        pending,
        days,
        currency: s.currency ?? "AED",
      });
    }

    list.sort((a, b) => a.days - b.days);
    return list;
  }, [mounted, statements, paidMap]);

  // ---------- ACTIONS ----------
  async function addCard(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!supabase) return;

    if (!userId) {
      setMsg("Please sign in first.");
      return;
    }

    const name = cardName.trim();
    if (!name) {
      setMsg("Card name is required.");
      return;
    }

    const credit_limit = Number(cardLimit.trim() || "0");
    const payload = {
      user_id: userId,
      name,
      bank: cardBank.trim() || null,
      credit_limit: Number.isFinite(credit_limit) ? credit_limit : 0,
      currency: (cardCurrency || "AED").trim() || "AED",
      notes: cardNotes.trim() || null,
    };

    const { error } = await supabase.from("cards").insert(payload);
    if (error) {
      setMsg("Save error: " + error.message);
      return;
    }

    setCardName("");
    setCardBank("");
    setCardLimit("");
    setCardCurrency("AED");
    setCardNotes("");
    await loadAll();
  }

  async function deleteCard(cardId: string) {
    if (!supabase) return;
    if (!confirm("Delete this card? This will remove its statements and payments.")) return;

    setMsg("");

    // delete related rows first
    const p1 = await supabase.from("payments").delete().eq("user_id", userId).eq("card_id", cardId);
    if (p1.error) return setMsg("Delete payments error: " + p1.error.message);

    const s1 = await supabase.from("statements").delete().eq("user_id", userId).eq("card_id", cardId);
    if (s1.error) return setMsg("Delete statements error: " + s1.error.message);

    const c1 = await supabase.from("cards").delete().eq("user_id", userId).eq("id", cardId);
    if (c1.error) return setMsg("Delete card error: " + c1.error.message);

    if (selectedCardId === cardId) setSelectedCardId("");
    if (payCardId === cardId) {
      setPayCardId("");
      setPayStatementId("");
    }

    await loadAll();
  }

  function resetStatementForm() {
    setEditingStatementId("");
    setStMonth("");
    setStDate("");
    setStDue("");
    setStAmount("");
  }

  function startEditStatement(s: StatementRow) {
    setTab("STATEMENTS");
    setSelectedCardId(s.card_id);
    setEditingStatementId(s.id);
    setStMonth(s.statement_month || "");
    setStDate(s.statement_date || "");
    setStDue(s.due_date || "");
    setStAmount(String(s.statement_amount ?? ""));
  }

  async function saveStatement(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!supabase) return;

    if (!userId) return setMsg("Please sign in first.");
    if (!selectedCardId) return setMsg("Select a card first.");

    const month = monthFirstDay(stMonth);
    if (!month) return setMsg("Statement month is required.");

    const amount = Number(stAmount.trim() || "0");
    const payload: any = {
      user_id: userId,
      card_id: selectedCardId,
      statement_month: month,
      statement_date: stDate || null,
      due_date: stDue || null,
      statement_amount: Number.isFinite(amount) ? amount : 0,
      currency: "AED",
    };

    // Use UPSERT to avoid duplicate month error
    const { error } = await supabase
      .from("statements")
      .upsert(payload, { onConflict: "user_id,card_id,statement_month" });

    if (error) {
      setMsg("Save statement error: " + error.message);
      return;
    }

    resetStatementForm();
    await loadAll();
  }

  async function deleteStatement(statementId: string) {
    if (!supabase) return;
    if (!confirm("Delete this statement?")) return;
    setMsg("");

    // unlink payments first
    const u1 = await supabase
      .from("payments")
      .update({ statement_id: null })
      .eq("user_id", userId)
      .eq("statement_id", statementId);

    if (u1.error) return setMsg("Unlink payments error: " + u1.error.message);

    const d1 = await supabase.from("statements").delete().eq("user_id", userId).eq("id", statementId);
    if (d1.error) return setMsg("Delete statement error: " + d1.error.message);

    await loadAll();
  }

  function resetPaymentForm() {
    setEditingPaymentId("");
    setPayCardId("");
    setPayStatementId("");
    // keep payDate
    setPayAmount("");
    setPayNote("");
  }

  function startEditPayment(p: PaymentRow) {
    setTab("PAYMENTS");
    setEditingPaymentId(p.id);
    setPayCardId(p.card_id ?? "");
    setPayStatementId(p.statement_id ?? "");
    setPayDate(p.payment_date || "");
    setPayAmount(String(p.amount ?? ""));
    setPayNote(p.note ?? "");
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!supabase) return;

    if (!userId) return setMsg("Please sign in first.");
    if (!payCardId) return setMsg("Select a card.");

    const amount = Number(payAmount.trim() || "0");
    const payload: any = {
      user_id: userId,
      kind: "CARD",
      card_id: payCardId,
      statement_id: payStatementId || null,
      payment_date: payDate,
      amount: Number.isFinite(amount) ? amount : 0,
      currency: "AED",
      note: payNote.trim() || null,
    };

    if (editingPaymentId) {
      const { error } = await supabase.from("payments").update(payload).eq("user_id", userId).eq("id", editingPaymentId);
      if (error) return setMsg("Update payment error: " + error.message);
    } else {
      const { error } = await supabase.from("payments").insert(payload);
      if (error) return setMsg("Save payment error: " + error.message);
    }

    resetPaymentForm();
    await loadAll();
  }

  async function deletePayment(paymentId: string) {
    if (!supabase) return;
    if (!confirm("Delete this payment?")) return;

    setMsg("");
    const { error } = await supabase.from("payments").delete().eq("user_id", userId).eq("id", paymentId);
    if (error) return setMsg("Delete payment error: " + error.message);

    await loadAll();
  }

  async function updatePaymentStatement(paymentId: string, statementId: string) {
    if (!supabase) return;
    setMsg("");

    const { error } = await supabase
      .from("payments")
      .update({ statement_id: statementId || null })
      .eq("user_id", userId)
      .eq("id", paymentId);

    if (error) return setMsg("Update link error: " + error.message);
    await loadAll();
  }

  // statement options depend on selected card in payment form
  const paymentStatementOptions = payCardId ? statementsByCard.get(payCardId) ?? [] : [];

  // ---------- RENDER ----------
  if (!mounted) {
    return <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>Loading…</div>;
  }

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

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Debt Tracker</h1>
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
              fontWeight: 800,
              background: tab === t ? "#eee" : "white",
            }}
          >
            {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto", opacity: 0.7 }}>
          Old pages: <Link href="/cards">/cards</Link>, <Link href="/statements">/statements</Link>,{" "}
          <Link href="/payments">/payments</Link>
        </div>
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
                        Pending: {s.currency} {Number(s.pending ?? 0).toFixed(2)}
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

            <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", fontWeight: 800 }}>
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
                  <div key={c.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12, display: "flex", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 900 }}>
                        {c.name} {c.bank ? `• ${c.bank}` : ""}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        Limit: {c.currency ?? "AED"} {Number(c.credit_limit ?? 0).toFixed(2)}
                      </div>
                      <div style={{ marginTop: 6, fontWeight: 900 }}>
                        Pending: {c.currency ?? "AED"} {pending.toFixed(2)}
                      </div>
                      {c.notes ? <div style={{ marginTop: 6, opacity: 0.8 }}>{c.notes}</div> : null}
                    </div>
                    <div>
                      <button
                        type="button"
                        onClick={() => deleteCard(c.id)}
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999", fontWeight: 800 }}
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
            <div style={{ fontWeight: 900 }}>{editingStatementId ? "Edit Statement (will UPSERT)" : "Add / Update Statement (UPSERT)"}</div>

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
              <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", fontWeight: 800 }}>
                Save Statement
              </button>

              {editingStatementId ? (
                <button
                  type="button"
                  onClick={resetStatementForm}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", fontWeight: 800 }}
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
            <p style={{ marginTop: 10 }}>Select a card to view statements.</p>
          ) : cardStatements.length === 0 ? (
            <p style={{ marginTop: 10 }}>No statements for this card.</p>
          ) : (
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {cardStatements.map((s) => {
                const amount = Number(s.statement_amount ?? 0);
                const paid = paidMap.get(s.id) ?? 0;
                const pending = Math.max(0, amount - paid);

                return (
                  <div key={s.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 900 }}>Month: {s.statement_month}</div>
                    <div style={{ marginTop: 6 }}>Amount: {s.currency ?? "AED"} {amount.toFixed(2)}</div>
                    <div style={{ marginTop: 6 }}>Paid: {s.currency ?? "AED"} {paid.toFixed(2)}</div>
                    <div style={{ marginTop: 6, fontWeight: 900 }}>Pending: {s.currency ?? "AED"} {pending.toFixed(2)}</div>
                    <div style={{ marginTop: 6, opacity: 0.8 }}>
                      Due: {s.due_date ?? "-"} | Statement Date: {s.statement_date ?? "-"}
                    </div>

                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => startEditStatement(s)}
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999", fontWeight: 800 }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteStatement(s.id)}
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999", fontWeight: 800 }}
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
              <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", fontWeight: 800 }}>
                {editingPaymentId ? "Update Payment" : "Save Payment"}
              </button>

              {editingPaymentId ? (
                <button
                  type="button"
                  onClick={resetPaymentForm}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999", fontWeight: 800 }}
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
                const st = p.statement_id ? statements.find((x) => x.id === p.statement_id) : null;
                const options = p.card_id ? statementsByCard.get(p.card_id) ?? [] : [];

                return (
                  <div key={p.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 900 }}>
                      {p.kind} • {p.payment_date}
                      {card ? ` • ${card.name}${card.bank ? " - " + card.bank : ""}` : ""}
                    </div>

                    <div style={{ marginTop: 6 }}>Amount: {p.currency ?? "AED"} {Number(p.amount ?? 0).toFixed(2)}</div>
                    {p.note ? <div style={{ marginTop: 6, opacity: 0.8 }}>{p.note}</div> : null}

                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 13, opacity: 0.8 }}>Quick link statement (affects Paid/Pending):</div>
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
                      {st ? <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>Current: {st.statement_month}</div> : null}
                    </div>

                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => startEditPayment(p)}
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #999", fontWeight: 800 }}
                      >
