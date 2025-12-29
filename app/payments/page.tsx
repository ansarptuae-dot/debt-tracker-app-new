"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type CardRow = { id: string; name: string; bank: string | null; currency: string | null };
type StatementRow = { id: string; card_id: string; statement_month: string; due_date: string | null; currency: string | null };
type LoanRow = { id: string; name: string; lender: string | null; currency: string | null };
type PersonalRow = { id: string; name: string; direction: "IOWE" | "OWESME"; currency: string | null };

type PaymentRow = {
  id: string;
  payment_date: string;
  amount: number | null;
  currency: string | null;
  kind: "CARD" | "LOAN" | "PERSONAL";
  note: string | null;
  card_id: string | null;
  statement_id: string | null;
  loan_id: string | null;
  personal_debt_id: string | null;
  created_at: string;
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function PaymentsPage() {
  const supabase = createClient();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const [cards, setCards] = useState<CardRow[]>([]);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [personals, setPersonals] = useState<PersonalRow[]>([]);

  const [kind, setKind] = useState<"CARD" | "LOAN" | "PERSONAL">("CARD");
  const [cardId, setCardId] = useState("");
  const [statementId, setStatementId] = useState("");
  const [loanId, setLoanId] = useState("");
  const [personalId, setPersonalId] = useState("");

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const cardMap = useMemo(() => {
    const map = new Map<string, CardRow>();
    cards.forEach((c) => map.set(c.id, c));
    return map;
  }, [cards]);

  const statementMap = useMemo(() => {
    const map = new Map<string, StatementRow>();
    statements.forEach((s) => map.set(s.id, s));
    return map;
  }, [statements]);

  const cardStatements = useMemo(
    () => statements.filter((s) => s.card_id === cardId),
    [statements, cardId]
  );

  async function loadAll() {
    setLoading(true);
    setMsg("");

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      setUserEmail(null);
      setLoading(false);
      return;
    }
    setUserEmail(user.email ?? "");

    const [cardsRes, stRes, loansRes, persRes, payRes] = await Promise.all([
      supabase.from("cards").select("id,name,bank,currency").is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("statements").select("id,card_id,statement_month,due_date,currency").is("deleted_at", null).order("statement_month", { ascending: false }),
      supabase.from("loans").select("id,name,lender,currency").is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("personal_debts").select("id,name,direction,currency").is("deleted_at", null).order("created_at", { ascending: false }),
      supabase.from("payments").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
    ]);

    if (cardsRes.error) setMsg("Cards load error: " + cardsRes.error.message);
    if (stRes.error) setMsg("Statements load error: " + stRes.error.message);
    if (loansRes.error) setMsg("Loans load error: " + loansRes.error.message);
    if (persRes.error) setMsg("Personal load error: " + persRes.error.message);
    if (payRes.error) setMsg("Payments load error: " + payRes.error.message);

    const cardsRows = (cardsRes.data ?? []) as CardRow[];
    const stRows = (stRes.data ?? []) as StatementRow[];

    setCards(cardsRows);
    setStatements(stRows);
    setLoans((loansRes.data ?? []) as LoanRow[]);
    setPersonals((persRes.data ?? []) as PersonalRow[]);
    setPayments((payRes.data ?? []) as PaymentRow[]);

    // default card
    const firstCard = cardsRows[0];
    if (firstCard && !cardId) setCardId(firstCard.id);

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMsg("");
    setStatementId("");
  }, [kind]);

  // ✅ auto-pick latest statement for the chosen card
  useEffect(() => {
    if (kind !== "CARD") return;
    const list = cardStatements;
    if (list.length > 0 && !statementId) setStatementId(list[0].id);
    if (list.length === 0) setStatementId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, kind, statements]);

  async function onAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg("");

    const form =
      e.currentTarget instanceof HTMLFormElement
        ? e.currentTarget
        : ((e.target as HTMLElement).closest("form") as HTMLFormElement | null);

    if (!form) return;

    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes?.user;
    if (!user) {
      setMsg("Please sign in first.");
      return;
    }

    const fd = new FormData(form);
    const payment_date = String(fd.get("payment_date") || "").trim();
    const amount = Number(String(fd.get("amount") || "0").trim() || 0);
    const note = String(fd.get("note") || "").trim() || null;

    if (!payment_date) {
      setMsg("Payment date is required.");
      return;
    }

    // choose currency
    let currency = "AED";
    if (kind === "CARD") currency = cards.find((c) => c.id === cardId)?.currency ?? "AED";
    if (kind === "LOAN") currency = loans.find((l) => l.id === loanId)?.currency ?? "AED";
    if (kind === "PERSONAL") currency = personals.find((p) => p.id === personalId)?.currency ?? "AED";

    const payload: any = {
      user_id: user.id,
      kind,
      payment_date,
      amount: Number.isFinite(amount) ? amount : 0,
      currency,
      note,
      card_id: null,
      statement_id: null,
      loan_id: null,
      personal_debt_id: null,
    };

    if (kind === "CARD") {
      if (!cardId) {
        setMsg("Select a card.");
        return;
      }
      payload.card_id = cardId;
      payload.statement_id = statementId || null; // ✅ link to statement if chosen
    } else if (kind === "LOAN") {
      if (!loanId) {
        setMsg("Select a loan.");
        return;
      }
      payload.loan_id = loanId;
    } else if (kind === "PERSONAL") {
      if (!personalId) {
        setMsg("Select a personal debt.");
        return;
      }
      payload.personal_debt_id = personalId;
    }

    const { error } = await supabase.from("payments").insert(payload);
    if (error) {
      setMsg("Save error: " + error.message);
      return;
    }

    form.reset();
    await loadAll();
  }

  async function updatePaymentStatement(paymentId: string, newStatementId: string) {
    setMsg("");
    const { error } = await supabase
      .from("payments")
      .update({ statement_id: newStatementId || null })
      .eq("id", paymentId);

    if (error) {
      setMsg("Update error: " + error.message);
      return;
    }

    await loadAll();
  }

  if (!userEmail) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Payments</h1>
        <p style={{ marginTop: 8 }}>Please sign in first.</p>
        <p style={{ marginTop: 8 }}>
          Go to <Link href="/">Home</Link> and sign in.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>Payments</h1>
      <div style={{ marginTop: 6, opacity: 0.75 }}>Signed in as: {userEmail}</div>

      <div style={{ marginTop: 16, padding: 16, border: "1px solid #ddd", borderRadius: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Add Payment</h2>

        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <label>
            Kind:&nbsp;
            <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="CARD">CARD</option>
              <option value="LOAN">LOAN</option>
              <option value="PERSONAL">PERSONAL</option>
            </select>
          </label>

          {kind === "CARD" ? (
            <>
              <label>
                Card:&nbsp;
                <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                  <option value="">Select</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.bank ? ` - ${c.bank}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Statement:&nbsp;
                <select value={statementId} onChange={(e) => setStatementId(e.target.value)}>
                  <option value="">None</option>
                  {cardStatements.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.statement_month}{s.due_date ? ` (Due ${s.due_date})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {kind === "LOAN" ? (
            <label>
              Loan:&nbsp;
              <select value={loanId} onChange={(e) => setLoanId(e.target.value)}>
                <option value="">Select</option>
                {loans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}{l.lender ? ` - ${l.lender}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {kind === "PERSONAL" ? (
            <label>
              Personal:&nbsp;
              <select value={personalId} onChange={(e) => setPersonalId(e.target.value)}>
                <option value="">Select</option>
                {personals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.direction})
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div style={{ marginLeft: "auto" }}>
            <Link href="/statements">Statements</Link> &nbsp;|&nbsp; <Link href="/cards">Cards</Link>
          </div>
        </div>

        <form onSubmit={onAdd} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <label>
            Payment date
            <input name="payment_date" type="date" defaultValue={todayISO()} required />
          </label>

          <label>
            Amount
            <input name="amount" placeholder="e.g., 500" inputMode="decimal" />
          </label>

          <label>
            Note (optional)
            <input name="note" placeholder="e.g., cash payment" />
          </label>

          <button type="submit" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #999" }}>
            Save Payment
          </button>

          {msg ? <div style={{ color: msg.toLowerCase().includes("error") ? "crimson" : "black" }}>{msg}</div> : null}
        </form>
      </div>

      <div style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Latest Payments (last 50)</h2>

        {loading ? (
          <p style={{ marginTop: 10 }}>Loading…</p>
        ) : payments.length === 0 ? (
          <p style={{ marginTop: 10 }}>No payments yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {payments.map((p) => {
              const cardLabel =
                p.card_id && cardMap.get(p.card_id)
                  ? `${cardMap.get(p.card_id)!.name}${cardMap.get(p.card_id)!.bank ? " - " + cardMap.get(p.card_id)!.bank : ""}`
                  : "";

              const stLabel =
                p.statement_id && statementMap.get(p.statement_id)
                  ? statementMap.get(p.statement_id)!.statement_month
                  : "";

              const stOptions =
                p.kind === "CARD" && p.card_id
                  ? statements.filter((s) => s.card_id === p.card_id)
                  : [];

              return (
                <div key={p.id} style={{ padding: 14, border: "1px solid #ddd", borderRadius: 12 }}>
                  <div style={{ fontWeight: 700 }}>
                    {p.kind} • {p.payment_date}
                    {cardLabel ? ` • ${cardLabel}` : ""}
                  </div>

                  <div style={{ marginTop: 6 }}>
                    Amount: {p.currency ?? "AED"} {Number(p.amount ?? 0).toFixed(2)}
                  </div>

                  {p.kind === "CARD" ? (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 13, opacity: 0.8 }}>Linked statement (for Pending calc):</div>
                      <select
                        value={p.statement_id ?? ""}
                        onChange={(e) => updatePaymentStatement(p.id, e.target.value)}
                        style={{ marginTop: 6 }}
                      >
                        <option value="">None</option>
                        {stOptions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.statement_month}{s.due_date ? ` (Due ${s.due_date})` : ""}
                          </option>
                        ))}
                      </select>
                      {stLabel ? <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>Current: {stLabel}</div> : null}
                    </div>
                  ) : null}

                  {p.note ? <div style={{ marginTop: 6, opacity: 0.85 }}>{p.note}</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
