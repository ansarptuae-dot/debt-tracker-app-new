"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
  statement_month: string; // YYYY-MM-DD
  statement_date: string | null; // YYYY-MM-DD
  due_date: string | null; // YYYY-MM-DD
  statement_amount: number | null;
  currency: string | null;
  created_at?: string;
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
  created_at?: string;
};

type Tab = "OVERVIEW" | "CARDS" | "STATEMENTS" | "PAYMENTS";

function toFirstOfMonth(dateStr: string) {
  // dateStr like "2025-12-29" -> "2025-12-01"
  if (!dateStr) return "";
  const [y, m] = dateStr.split("-").map((x) => Number(x));
  if (!y || !m) return "";
  const mm = String(m).padStart(2, "0");
  return `${y}-${mm}-01`;
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);

  const [tab, setTab] = useState<Tab>("OVERVIEW");

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [cards, setCards] = useState<CardRow[]>([]);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  // ---------- Cards form ----------
  const [editingCardId, setEditingCardId] = useState<string>("");
  const [cName, setCName] = useState("");
  const [cBank, setCBank] = useState("");
  const [cLimit, setCLimit] = useState("");
  const [cCurrency, setCCurrency] = useState("AED");
  const [cNotes, setCNotes] = useState("");

  // ---------- Statements form ----------
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [editingStatementId, setEditingStatementId] = useState<string>("");
  const [stMonth, setStMonth] = useState<string>(""); // date input
  const [stDate, setStDate] = useState<string>(""); // date input
  const [stDue, setStDue] = useState<string>(""); // date input
  const [stAmount, setStAmount] = useState<string>("");

  // ---------- Payments form ----------
  const [editingPaymentId, setEditingPaymentId] = useState<string>("");
  const [payCardId, setPayCardId] = useState<string>("");
  const [payStatementId, setPayStatementId] = useState<string>("");
  const [payDate, setPayDate] = useState<string>("");
  const [payAmount, setPayAmount] = useState<string>("");
  const [payNote, setPayNote] = useState<string>("");

  // Avoid new Date() during render: set default date values after mount
  useEffect(() => {
    const d = new Date();
    const iso = d.toISOString().slice(0, 10);
    setPayDate(iso);
    setStMonth(iso);
  }, []);

  async function loadAll(currentUserId: string) {
    setLoading(true);
    setMsg("");

    try {
      const [cardsRes, stRes, payRes] = await Promise.all([
        supabase.from("cards").select("*").eq("user_id", currentUserId).order("created_at", { ascending: false }),
        supabase.from("statements").select("*").eq("user_id", currentUserId).order("statement_month", { ascending: false }),
        supabase.from("payments").select("*").eq("user_id", currentUserId).order("payment_date", { ascending: false }).limit(50),
      ]);

      if (cardsRes.error) throw new Error("Cards load error: " + cardsRes.error.message);
      if (stRes.error) throw new Error("Statements load error: " + stRes.error.message);
      if (payRes.error) throw new Error("Payments load error: " + payRes.error.message);

      setCards((cardsRes.data as any) ?? []);
      setStatements((stRes.data as any) ?? []);
      setPayments((payRes.data as any) ?? []);
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      const { data } = await supabase.auth.getUser();
      const u = data?.user;

      if (!alive) return;

      if (!u) {
        setUserEmail("");
        setUserId("");
        setLoading(false);
        return;
      }

      setUserEmail(u.email ?? "");
      setUserId(u.id);
      await loadAll(u.id);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user;
      if (!u) {
        setUserEmail("");
        setUserId("");
        setCards([]);
        setStatements([]);
        setPayments([]);
        return;
      }
      setUserEmail(u.email ?? "");
      setUserId(u.id);
      await loadAll(u.id);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  async function signOut() {
    setMsg("");
    await supabase.auth.signOut();
  }

  // ---------- Derived calculations ----------
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

  const paidByStatement = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) {
      if (!p.statement_id) continue;
      m.set(p.statement_id, (m.get(p.statement_id) ?? 0) + safeNum(p.amount));
    }
    return m;
  }, [payments]);

  const pendingByCard = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of statements) {
      const amount = safeNum(s.statement_amount);
      const paid = paidByStatement.get(s.id) ?? 0;
      const pending = Math.max(0, amount - paid);
      m.set(s.card_id, (m.get(s.card_id) ?? 0) + pending);
    }
    return m;
  }, [statements, paidByStatement]);

  const totals = useMemo(() => {
    const totalLimit = cards.reduce((a, c) => a + safeNum(c.credit_limit), 0);
    const totalPending = cards.reduce((a, c) => a + (pendingByCard.get(c.id) ?? 0), 0);
    return { totalLimit, totalPending };
  }, [cards, pendingByCard]);

  const upcomingDue = useMemo(() => {
    // Compute using Date only inside memo AFTER mount is okay in client,
    // but to be safe, we avoid new Date() and use a simple check using ISO.
    // We'll still need a reference "today" once; use current day from payDate when available.
    const today = (payDate || "").slice(0, 10);
    if (!today) return [];

    const [ty, tm, td] = today.split("-").map((x) => Number(x));
    if (!ty || !tm || !td) return [];

    const todayObj = new Date(ty, tm - 1, td);
    const in30 = new Date(ty, tm - 1, td + 30);

    const rows: Array<{ id: string; card_id: string; statement_month: string; due_date: string; pending: number; currency: string }> =
      [];

    for (const s of statements) {
      if (!s.due_date) continue;
      const pending = Math.max(0, safeNum(s.statement_amount) - (paidByStatement.get(s.id) ?? 0));
      if (pending <= 0) continue;

      const [y, m, d] = s.due_date.split("-").map((x) => Number(x));
      if (!y || !m || !d) continue;

      const dueObj = new Date(y, m - 1, d);
      if (dueObj < todayObj || dueObj > in30) continue;

      rows.push({
        id: s.id,
        card_id: s.card_id,
        statement_month: s.statement_month,
        due_date: s.due_date,
        pending,
        currency: s.currency ?? "AED",
      });
    }

    rows.sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    return rows;
  }, [statements, paidByStatement, payDate]);

  // ---------- UI helpers ----------
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ccc",
    marginTop: 6,
  };

  const btnStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #999",
    fontWeight: 800,
    background: "white",
  };

  function resetCardForm() {
    setEditingCardId("");
    setCName("");
    setCBank("");
    setCLimit("");
    setCCurrency("AED");
    setCNotes("");
  }

  function resetStatementForm() {
    setEditingStatementId("");
    setStDate("");
    setStDue("");
    setStAmount("");
  }

  function resetPaymentForm() {
    setEditingPaymentId("");
    setPayCardId("");
    setPayStatementId("");
    setPayAmount("");
    setPayNote("");
  }

  // ---------- Cards CRUD ----------
  async function saveCard(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!userId) return setMsg("Please sign in first.");
    if (!cName.trim()) return setMsg("Card name is required.");

    const payload = {
      user_id: userId,
      name: cName.trim(),
      bank: cBank.trim() ? cBank.trim() : null,
      credit_limit: safeNum(cLimit),
      currency: cCurrency.trim() ? cCurrency.trim() : "AED",
      notes: cNotes.trim() ? cNotes.trim() : null,
    };

    if (editingCardId) {
      const { error } = await supabase.from("cards").update(payload).eq("id", editingCardId).eq("user_id", userId);
      if (error) return setMsg("Update card error: " + error.message);
      setMsg("Card updated.");
    } else {
      const { error } = await supabase.from("cards").insert(payload);
      if (error) return setMsg("Add card error: " + error.message);
      setMsg("Card saved.");
    }

    resetCardForm();
    await loadAll(userId);
  }

  function startEditCard(c: CardRow) {
    setTab("CARDS");
    setEditingCardId(c.id);
    setCName(c.name ?? "");
    setCBank(c.bank ?? "");
    setCLimit(String(c.credit_limit ?? ""));
    setCCurrency(c.currency ?? "AED");
    setCNotes(c.notes ?? "");
  }

  async function deleteCard(id: string) {
    setMsg("");
    if (!userId) return setMsg("Please sign in first.");

    const { error } = await supabase.from("cards").delete().eq("id", id).eq("user_id", userId);
    if (error) return setMsg("Delete card error: " + error.message);

    setMsg("Card deleted.");
    await loadAll(userId);
  }

  // ---------- Statements CRUD ----------
  async function saveStatement(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!userId) return setMsg("Please sign in first.");
    if (!selectedCardId) return setMsg("Select a card first.");
    if (!stMonth) return setMsg("Statement month is required.");

    const monthFirst = toFirstOfMonth(stMonth);
    if (!monthFirst) return setMsg("Invalid statement month.");

    const payload: any = {
      user_id: userId,
      card_id: selectedCardId,
      statement_month: monthFirst,
      statement_date: stDate ? stDate : null,
      due_date: stDue ? stDue : null,
      statement_amount: safeNum(stAmount),
      currency: (cardMap.get(selectedCardId)?.currency ?? "AED") as string,
    };

    if (editingStatementId) {
      const { error } = await supabase.from("statements").update(payload).eq("id", editingStatementId).eq("user_id", userId);
      if (error) return setMsg("Update statement error: " + error.message);
      setMsg("Statement updated.");
    } else {
      // Upsert to avoid duplicate month errors
      const { error } = await supabase
        .from("statements")
        .upsert(payload, { onConflict: "user_id,card_id,statement_month" });

      if (error) return setMsg("Save statement error: " + error.message);
      setMsg("Statement saved (or updated if same month existed).");
    }

    resetStatementForm();
    await loadAll(userId);
  }

  function startEditStatement(s: StatementRow) {
    setTab("STATEMENTS");
    setEditingStatementId(s.id);
    setSelectedCardId(s.card_id);
    setStMonth(s.statement_month);
    setStDate(s.statement_date ?? "");
    setStDue(s.due_date ?? "");
    setStAmount(String(s.statement_amount ?? ""));
  }

  async function deleteStatement(id: string) {
    setMsg("");
    if (!userId) return setMsg("Please sign in first.");

    const { error } = await supabase.from("statements").delete().eq("id", id).eq("user_id", userId);
    if (error) return setMsg("Delete statement error: " + error.message);

    setMsg("Statement deleted.");
    await loadAll(userId);
  }

  // ---------- Payments CRUD ----------
  async function savePayment(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!userId) return setMsg("Please sign in first.");
    if (!payCardId) return setMsg("Select a card.");
    if (!payDate) return setMsg("Payment date required.");
    if (!payAmount) return setMsg("Amount required.");

    const payload: any = {
      user_id: userId,
      kind: "CARD",
      card_id: payCardId,
      statement_id: payStatementId ? payStatementId : null,
      payment_date: payDate,
      amount: safeNum(payAmount),
      currency: (cardMap.get(payCardId)?.currency ?? "AED") as string,
      note: payNote.trim() ? payNote.trim() : null,
    };

    if (editingPaymentId) {
      const { error } = await supabase.from("payments").update(payload).eq("id", editingPaymentId).eq("user_id", userId);
      if (error) return setMsg("Update payment error: " + error.message);
      setMsg("Payment updated.");
    } else {
      const { error } = await supabase.from("payments").insert(payload);
      if (error) return setMsg("Add payment error: " + error.message);
      setMsg("Payment saved.");
    }

    resetPaymentForm();
    await loadAll(userId);
  }

  function startEditPayment(p: PaymentRow) {
    setTab("PAYMENTS");
    setEditingPaymentId(p.id);
    setPayCardId(p.card_id ?? "");
    setPayStatementId(p.statement_id ?? "");
    setPayDate(p.payment_date ?? "");
    setPayAmount(String(p.amount ?? ""));
    setPayNote(p.note ?? "");
  }

  async function deletePayment(id: string) {
    setMsg("");
    if (!userId) return setMsg("Please sign in first.");

    const { error } = await supabase.from("payments").delete().eq("id", id).eq("user_id", userId);
    if (error) return setMsg("Delete payment error: " + error.message);

    setMsg("Payment deleted.");
    await loadAll(userId);
  }

  async function updatePaymentStatement(paymentId: string, statementId: string) {
    setMsg("");
    if (!userId) return setMsg("Please sign in first.");

    const { error } = await supabase
      .from("payments")
      .update({ statement_id: statementId ? statementId : null })
      .eq("id", paymentId)
      .eq("user_id", userId);

    if (error) return setMsg("Update payment error: " + error.message);

    await loadAll(userId);
  }

  const cardStatements = selectedCardId ? statementsByCard.get(selectedCardId) ?? [] : [];
  const paymentStatementOptions = payCardId ? statementsByCard.get(payCardId) ?? [] : [];

  // ---------- Auth gate ----------
  if (!userEmail) {
    return (
      <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Debt Tracker</h1>
        <p style={{ marginTop: 10 }}>Please sign in first.</p>
        <div style={{ marginTop: 10, display: "flex", gap: 12 }}>
          <Link href="/auth/login">Login</Link>
          <Link href="/auth/sign-up">Sign up</Link>
        </div>
        <div style={{ marginTop: 14, opacity: 0.7 }}>
          Tip: On iPhone open <b>/dashboard</b> (all-in-one page).
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 14, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Debt Tracker</h1>
        <div style={{ opacity: 0.8 }}>Signed in as: {userEmail}</div>

        <button onClick={signOut} style={{ marginLeft: "auto", ...btnStyle }}>
          Logout
        </button>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["OVERVIEW", "CARDS", "STATEMENTS", "PAYMENTS"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...btnStyle,
              borderRadius: 999,
              background: tab === t ? "#eee" : "white",
            }}
          >
            {t}
          </button>
        ))}

        <div style={{ marginLeft: "auto", opacity: 0.65, fontSize: 13 }}>
          (Old pages: <Link href="/cards">/cards</Link>, <Link href="/statements">/statements</Link>,{" "}
          <Link href="/payments">/payments</Link>)
        </div>
      </div>

      {msg ? (
        <div style={{ marginTop: 10, color: msg.toLowerCase().includes("error") ? "crimson" : "black", fontWeight: 700 }}>
          {msg}
        </div>
      ) : null}

      {/* ---------------- OVERVIEW ---------------- */}
      {tab === "OVERVIEW" ? (
        <>
          <div
            style={{
              marginTop: 14,
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
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>AED {totals.totalLimit.toFixed(2)}</div>
            </div>

            <div style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
              <div style={{ opacity: 0.8 }}>Total Pending</div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 6 }}>AED {totals.totalPending.toFixed(2)}</div>
            </div>
          </div>

          <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
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
                      <div style={{ fontWeight: 900 }}>{label} • Due {s.due_date}</div>
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
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Cards</div>

          <form onSubmit={saveCard} style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <div style={{ fontWeight: 900 }}>{editingCardId ? "Edit Card" : "Add Card"}</div>

            <label>
              Card name (required)
              <input style={inputStyle} value={cName} onChange={(e) => setCName(e.target.value)} placeholder="e.g., RAK BANK" required />
            </label>

            <label>
              Bank (optional)
              <input style={inputStyle} value={cBank} onChange={(e) => setCBank(e.target.value)} placeholder="e.g., RAK" />
            </label>

            <label>
              Credit limit
              <input style={inputStyle} value={cLimit} onChange={(e) => setCLimit(e.target.value)} placeholder="e.g., 6000" inputMode="decimal" />
            </label>

            <label>
              Currency
              <input style={inputStyle} value={cCurrency} onChange={(e) => setCCurrency(e.target.value)} />
            </label>

            <label>
              Notes (optional)
              <input style={inputStyle} value={cNotes} onChange={(e) => setCNotes(e.target.value)} placeholder="any notes" />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="submit" style={btnStyle}>
                {editingCardId ? "Update Card" : "Save Card"}
              </button>

              {editingCardId ? (
                <button type="button" style={btnStyle} onClick={resetCardForm}>
                  Cancel Edit
                </button>
              ) : null}
            </div>
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

                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button type="button" style={btnStyle} onClick={() => startEditCard(c)}>
                        Edit
                      </button>
                      <button type="button" style={btnStyle} onClick={() => deleteCard(c.id)}>
                        Delete
                      </button>
                      <button
                        type="button"
                        style={btnStyle}
                        onClick={() => {
                          setTab("STATEMENTS");
                          setSelectedCardId(c.id);
                          resetStatementForm();
                        }}
                      >
                        Statements
                      </button>
                      <button
                        type="button"
                        style={btnStyle}
                        onClick={() => {
                          setTab("PAYMENTS");
                          setPayCardId(c.id);
                          setPayStatementId("");
                          resetPaymentForm();
                        }}
                      >
                        Payment
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
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Statements</div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>Select Card</div>
            <select
              value={selectedCardId}
              onChange={(e) => {
                setSelectedCardId(e.target.value);
                resetStatementForm();
              }}
              style={{ ...inputStyle, maxWidth: 420 }}
            >
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
              <input style={inputStyle} value={stMonth} onChange={(e) => setStMonth(e.target.value)} type="date" required />
            </label>

            <label>
              Statement date (optional)
              <input style={inputStyle} value={stDate} onChange={(e) => setStDate(e.target.value)} type="date" />
            </label>

            <label>
              Due date (optional)
              <input style={inputStyle} value={stDue} onChange={(e) => setStDue(e.target.value)} type="date" />
            </label>

            <label>
              Statement amount
              <input style={inputStyle} value={stAmount} onChange={(e) => setStAmount(e.target.value)} placeholder="e.g., 1200" inputMode="decimal" />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="submit" style={btnStyle}>
                {editingStatementId ? "Update Statement" : "Save Statement"}
              </button>

              {editingStatementId ? (
                <button type="button" style={btnStyle} onClick={resetStatementForm}>
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
                const amount = safeNum(s.statement_amount);
                const paid = paidByStatement.get(s.id) ?? 0;
                const pending = Math.max(0, amount - paid);

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
                      <button type="button" style={btnStyle} onClick={() => startEditStatement(s)}>
                        Edit
                      </button>
                      <button type="button" style={btnStyle} onClick={() => deleteStatement(s.id)}>
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
        <div style={{ marginTop: 14, padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>Payments (Card)</div>

          <form onSubmit={savePayment} style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <div style={{ fontWeight: 900 }}>{editingPaymentId ? "Edit Payment" : "Add Payment"}</div>

            <label>
              Card
              <select
                style={inputStyle}
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
              <select style={inputStyle} value={payStatementId} onChange={(e) => setPayStatementId(e.target.value)} disabled={!payCardId}>
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
              <input style={inputStyle} value={payDate} onChange={(e) => setPayDate(e.target.value)} type="date" required />
            </label>

            <label>
              Amount
              <input style={inputStyle} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="e.g., 500" inputMode="decimal" />
            </label>

            <label>
              Note (optional)
              <input style={inputStyle} value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g., cash payment" />
            </label>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="submit" style={btnStyle}>
                {editingPaymentId ? "Update Payment" : "Save Payment"}
              </button>

              {editingPaymentId ? (
                <button type="button" style={btnStyle} onClick={resetPaymentForm}>
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
                const currentSt = p.statement_id ? statements.find((x) => x.id === p.statement_id) : null;

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
                      <div style={{ fontSize: 13, opacity: 0.8 }}>Link to statement (affects Paid/Pending):</div>
                      <select
                        style={{ ...inputStyle, marginTop: 8 }}
                        value={p.statement_id ?? ""}
                        onChange={(e) => updatePaymentStatement(p.id, e.target.value)}
                        disabled={!p.card_id}
                      >
                        <option value="">None</option>
                        {options.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.statement_month}
                            {s.due_date ? ` (Due ${s.due_date})` : ""}
                          </option>
                        ))}
                      </select>

                      {currentSt ? (
                        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>Current: {currentSt.statement_month}</div>
                      ) : null}
                    </div>

                    <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button type="button" style={btnStyle} onClick={() => startEditPayment(p)}>
                        Edit
                      </button>
                      <button type="button" style={btnStyle} onClick={() => deletePayment(p.id)}>
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
        Mobile tip: Use Safari “Share” → “Add to Home Screen” after you deploy. (Local IP works only on same Wi-Fi.)
      </div>
    </div>
  );
}
