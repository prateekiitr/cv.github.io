import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import {
  Plus, Trash2, Wallet, TrendingUp, TrendingDown, PiggyBank,
  CalendarClock, Landmark, Receipt, Loader2, Users, CreditCard,
  Layers, ArrowRight,
} from "lucide-react";

/* ---------------------------------------------------------------
   TOKENS — "Terminal" system: Bloomberg-style gold-on-navy, matching
   prateeksinghphd.in's finance blog theme.
------------------------------------------------------------------ */
const T = {
  paper: "#0A0F17", paperDim: "#0E141F", card: "#121A26",
  ink: "#E7E5DC", inkSoft: "#8996A6", navy: "#05080E",
  brass: "#D4AF37", brassDeep: "#B8901F", rust: "#E2574C",
  moss: "#4CC38A", rule: "#232C3A",
};

const FONT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');
.ldg-display { font-family: 'Space Grotesk', sans-serif; }
.ldg-mono { font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
.ldg-body { font-family: 'Inter', sans-serif; }
.ldg-dotted-leader { flex: 1; border-bottom: 1.5px dotted ${T.rule}; margin: 0 8px; height: 1px; transform: translateY(-4px); }
`;

/* ---------------------------------------------------------------
   GENERIC DEFAULTS — no identity, no employer, no join date. Every
   number here is meant to be replaced by whoever opens the app; the
   compensation model (Basic/HRA/LTA/PF/gratuity as % of gross) uses
   common Indian CTC conventions as a starting formula, not fixed
   figures.
------------------------------------------------------------------ */
const HIKE_MONTH = 3;           // April — most common Indian appraisal cycle
const DEFAULT_HIKE_PCT = 8;

const COMP_DEFAULTS = {
  basicPct: 50,        // Basic Pay as % of gross
  hraPctOfBasic: 40,    // HRA as % of basic (common range 40-50%)
  ltaPctOfBasic: 10,   // LTA as % of basic
  pfPctOfBasic: 12,    // Employer PF contribution as % of basic
  gratuityPctOfBasic: 4.81,
  annualBonusPct: 10,  // Annual/performance bonus as % of gross
};

const DEFAULT_LOANS = [];
const DEFAULT_RSU_GRANTS = [];
const DEFAULT_BONUSES = [];

/* deduction caps */
const CAPS = { sec80C: 150000, sec80D: 100000, nps80CCD1B: 50000, homeLoanInterest: 200000 };

const NEW_BRACKETS = [
  { upto: 400000, rate: 0 }, { upto: 800000, rate: 0.05 }, { upto: 1200000, rate: 0.10 },
  { upto: 1600000, rate: 0.15 }, { upto: 2000000, rate: 0.20 }, { upto: 2400000, rate: 0.25 }, { upto: Infinity, rate: 0.30 },
];
const OLD_BRACKETS = [
  { upto: 250000, rate: 0 }, { upto: 500000, rate: 0.05 }, { upto: 1000000, rate: 0.20 }, { upto: Infinity, rate: 0.30 },
];

function slabTax(income, brackets) {
  let tax = 0, prev = 0;
  for (const b of brackets) {
    if (income > prev) { tax += (Math.min(income, b.upto) - prev) * b.rate; prev = b.upto; }
    else break;
  }
  return tax;
}
function computeTax(taxableIncome, regime) {
  const brackets = regime === "new" ? NEW_BRACKETS : OLD_BRACKETS;
  const rebateThreshold = regime === "new" ? 1200000 : 500000;
  let base = slabTax(Math.max(0, taxableIncome), brackets);
  if (taxableIncome <= rebateThreshold) base = 0;
  let surcharge = 0;
  if (taxableIncome > 20000000) surcharge = base * 0.25;
  else if (taxableIncome > 10000000) surcharge = base * 0.15;
  else if (taxableIncome > 5000000) surcharge = base * 0.10;
  const cess = (base + surcharge) * 0.04;
  return { base, surcharge, cess, total: base + surcharge + cess };
}

const INR = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const INR_L = (n) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 10000000) return "₹" + (v / 10000000).toFixed(2) + " Cr";
  if (Math.abs(v) >= 100000) return "₹" + (v / 100000).toFixed(2) + " L";
  return INR(v);
};
const USD = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");

const INVESTMENT_TYPES = ["Mutual Fund", "Stocks / RSU", "PPF / EPF", "Fixed Deposit", "Real Estate", "Gold", "NPS", "Other"];
const EXPENSE_CATEGORIES = ["Rent", "Groceries", "Utilities", "Fuel", "Transport", "Dining Out", "Shopping", "Travel", "EMI / Loan", "Insurance", "Healthcare", "Other"];
const LOAN_TYPES = ["Home Loan", "Car Loan", "Personal Loan", "Education Loan", "Gold Loan", "Credit Card / Consumer", "Other"];
const PIE_COLORS = [T.brass, T.moss, "#5B8FD4", T.rust, "#8996A6", "#C9A876", "#3E8C6A", T.brassDeep];

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function emi(principal, annualRatePct, tenureMonths) {
  const r = annualRatePct / 12 / 100;
  if (!principal || !tenureMonths) return 0;
  if (r === 0) return principal / tenureMonths;
  const f = Math.pow(1 + r, tenureMonths);
  return (principal * r * f) / (f - 1);
}

/* Full amortization simulator.
   Handles: opening principal, fixed rate, EMI that steps at given installment
   numbers, and future disbursement tranches that increase the outstanding
   principal (construction-linked home loans). When a loan has disbursements
   and no explicit EMI steps, the EMI is re-derived after each tranche over the
   remaining tenure — which is what the bank actually does.
   Returns a month-by-month row array. */
function simulateLoan(loan) {
  const r = Number(loan.rate) / 12 / 100;
  const tenure = Number(loan.tenureMonths) || 240;
  const start = new Date(loan.startDate);
  const disb = (loan.disbursements || []).map((d) => ({ date: new Date(d.date), amount: Number(d.amount) }));
  const steps = (loan.emiSchedule || []).slice().sort((a, b) => a.fromInstallment - b.fromInstallment);
  const prepays = (loan.prepayments || []).map((p) => ({ date: new Date(p.date), amount: Number(p.amount) }));

  let bal = Number(loan.principal);
  let currentEmi = steps.length ? steps[0].emi : (Number(loan.emi) || emi(bal, loan.rate, tenure));
  const rows = [];

  for (let i = 1; i <= 600; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i - 1, 1);

    // Apply any disbursement tranches landing this month, then re-derive EMI.
    let disbursedThisMonth = 0;
    disb.forEach((t) => {
      if (t.date.getFullYear() === d.getFullYear() && t.date.getMonth() === d.getMonth()) {
        bal += t.amount;
        disbursedThisMonth += t.amount;
      }
    });
    if (disbursedThisMonth > 0 && !steps.length) {
      currentEmi = emi(bal, loan.rate, Math.max(12, tenure - i + 1));
    }

    const step = steps.filter((s) => i >= s.fromInstallment).pop();
    if (step) currentEmi = step.emi;

    // Prepayments: extra principal knocked off the balance the month they're
    // made. EMI is deliberately left unchanged — the loan just finishes
    // sooner (tenure reduction), matching how most Indian lenders apply a
    // part-prepayment by default.
    let prepaidThisMonth = 0;
    prepays.forEach((p) => {
      if (p.date.getFullYear() === d.getFullYear() && p.date.getMonth() === d.getMonth()) {
        const applied = Math.min(p.amount, bal);
        bal -= applied;
        prepaidThisMonth += applied;
      }
    });

    if (bal <= 0) {
      if (prepaidThisMonth > 0) rows.push({ n: i, date: d, key: monthKey(d), emi: 0, interest: 0, principal: 0, balance: 0, disbursed: disbursedThisMonth, prepaid: prepaidThisMonth });
      break;
    }
    let interest = bal * r;
    if (i === 1 && loan.firstInstallmentInterest) interest = Number(loan.firstInstallmentInterest);
    const principalPaid = Math.min(currentEmi - interest, bal);
    const paid = principalPaid + interest;
    bal = Math.max(0, bal - principalPaid);
    rows.push({ n: i, date: d, key: monthKey(d), emi: paid, interest, principal: principalPaid, balance: bal, disbursed: disbursedThisMonth, prepaid: prepaidThisMonth });
    if (bal <= 0) break;
  }
  return rows;
}

function loanSnapshot(loan) {
  const rows = simulateLoan(loan);
  const today = new Date();
  const nowKey = monthKey(today);
  const current = rows.find((x) => x.key === nowKey) || rows.find((x) => x.date >= today) || rows[rows.length - 1];
  const last = rows[rows.length - 1];
  const totalInterest = rows.reduce((s, x) => s + x.interest, 0);
  const baseline = (loan.prepayments || []).length ? simulateLoan({ ...loan, prepayments: [] }) : null;
  const baselineLast = baseline ? baseline[baseline.length - 1] : null;
  const baselineInterest = baseline ? baseline.reduce((s, x) => s + x.interest, 0) : null;
  return {
    rows,
    currentEmi: current ? current.emi : 0,
    balance: current ? current.balance : 0,
    payoffDate: last ? last.date : null,
    monthsLeft: last && current ? last.n - current.n : 0,
    totalInterest,
    interestSaved: baseline ? baselineInterest - totalInterest : 0,
    monthsSaved: baseline ? baselineLast.n - last.n : 0,
    baselinePayoffDate: baseline ? baselineLast.date : null,
  };
}
function monthKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function monthLabel(d) { return d.toLocaleString("en-US", { month: "short", year: "numeric" }); }
function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }

/* Financial year label for a date: Apr–Mar */
function fyOf(d) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { start: y, label: `FY ${y}-${String(y + 1).slice(2)}` };
}
/* Number of April hikes applied by a given date */
function hikeCount(d) {
  let n = 0;
  let cursor = new Date(2027, HIKE_MONTH, 1);
  while (cursor <= d) { n++; cursor = new Date(cursor.getFullYear() + 1, HIKE_MONTH, 1); }
  return n;
}
function grossAt(baseGross, d, hikePct) { return baseGross * Math.pow(1 + hikePct / 100, hikeCount(d)); }

function generateVestEvents(grant) {
  const periods = grant.frequency === "monthly" ? grant.vestYears * 12 : grant.vestYears * 4;
  const stepMonths = grant.frequency === "monthly" ? 1 : 3;
  const perVest = grant.amountUsd / (periods || 1);
  const events = [];
  const start = new Date(grant.grantDate);
  for (let i = 1; i <= periods; i++) {
    const d = new Date(start);
    d.setMonth(d.getMonth() + stepMonths * i);
    events.push({ date: d, amountUsd: perVest, grantName: grant.name });
  }
  return events;
}

/* ---------------- building blocks ---------------- */
function Stamp({ children, tone = "brass" }) {
  const color = tone === "brass" ? T.brass : tone === "moss" ? T.moss : T.rust;
  return <span className="ldg-mono" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color, border: `1.5px solid ${color}`, borderRadius: 3, padding: "3px 8px", transform: "rotate(-1deg)" }}>{children}</span>;
}
function LedgerRow({ label, value, sub, bold, indent, tone }) {
  return (
    <div className="ldg-body" style={{ display: "flex", alignItems: "baseline", padding: "9px 0", borderBottom: `1px solid ${T.rule}`, paddingLeft: indent ? 16 : 0 }}>
      <span style={{ color: bold ? T.ink : T.inkSoft, fontWeight: bold ? 600 : 400, fontSize: 14 }}>
        {label}{sub && <span style={{ display: "block", fontSize: 11, color: T.inkSoft, fontStyle: "italic", fontWeight: 400 }}>{sub}</span>}
      </span>
      <span className="ldg-dotted-leader" />
      <span className="ldg-mono" style={{ color: tone || (bold ? T.ink : T.inkSoft), fontWeight: bold ? 700 : 500, fontSize: 14 }}>{value}</span>
    </div>
  );
}
function Card({ children, style }) { return <div style={{ background: T.card, border: `1px solid ${T.rule}`, borderRadius: 6, padding: 20, ...style }}>{children}</div>; }
function StatCard({ icon: Icon, label, value, tone = T.ink, note }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon size={16} color={T.brass} strokeWidth={2} />
        <span className="ldg-mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.inkSoft }}>{label}</span>
      </div>
      <div className="ldg-display" style={{ fontSize: 26, fontWeight: 600, color: tone, lineHeight: 1.1 }}>{value}</div>
      {note && <div className="ldg-body" style={{ fontSize: 12, color: T.inkSoft, marginTop: 6 }}>{note}</div>}
    </Card>
  );
}
function Field({ label, hint, children }) {
  return <div>
    <div className="ldg-mono" style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: T.inkSoft, marginBottom: 4 }}>{label}</div>
    {children}
    {hint && <div style={{ fontSize: 10.5, color: T.inkSoft, marginTop: 3, fontStyle: "italic" }}>{hint}</div>}
  </div>;
}
function EmptyState({ text }) { return <div style={{ padding: "28px 10px", textAlign: "center", color: T.inkSoft, fontSize: 13, border: `1px dashed ${T.rule}`, borderRadius: 6 }}>{text}</div>; }

const inputStyle = { width: "100%", border: `1px solid ${T.rule}`, borderRadius: 4, padding: "8px 9px", fontSize: 13, background: T.paper, color: T.ink, fontFamily: "Inter", boxSizing: "border-box" };
const addBtnStyle = { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: T.navy, color: T.ink, border: "none", borderRadius: 4, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };
const iconBtnStyle = { background: "none", border: "none", color: T.inkSoft, cursor: "pointer", padding: 6, display: "flex" };

const TABS = [
  { id: "salary", label: "Salary & Tax" },
  { id: "overview", label: "Overview" },
  { id: "schedule", label: "Monthly Schedule" },
  { id: "income", label: "Household Income" },
  { id: "investments", label: "Investments" },
  { id: "loans", label: "Loans" },
  { id: "expenses", label: "Spends" },
];

const DEFAULT_DEDUCTIONS = {
  sec80C: 150000, sec80D: 25000, nps80CCD1B: 50000, homeLoanInterest: 0,
  foodCoupons: 26400, fuelAllowance: 0, telephone: 0, otherFbp: 0,
};

export default function FinanceDashboard() {
  const [tab, setTab] = useState("salary");
  const [ready, setReady] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const [usdInr, setUsdInr] = useState(96);
  const [hikePct, setHikePct] = useState(DEFAULT_HIKE_PCT);
  const [taxRegime, setTaxRegime] = useState("new");
  const [monthlyRent, setMonthlyRent] = useState(0);
  const [ded, setDed] = useState(DEFAULT_DEDUCTIONS);
  const [includeEmployeePF, setIncludeEmployeePF] = useState(true);
  const [sideIncomeMonthly, setSideIncomeMonthly] = useState(0);
  const [spouseIncomeMonthly, setSpouseIncomeMonthly] = useState(0);
  const [includeRsuInIncome, setIncludeRsuInIncome] = useState(true);

  const [grossSalary, setGrossSalary] = useState(0);
  const [basicPct, setBasicPct] = useState(COMP_DEFAULTS.basicPct);
  const [hraPctOfBasic, setHraPctOfBasic] = useState(COMP_DEFAULTS.hraPctOfBasic);
  const [ltaPctOfBasic, setLtaPctOfBasic] = useState(COMP_DEFAULTS.ltaPctOfBasic);
  const [pfPctOfBasic, setPfPctOfBasic] = useState(COMP_DEFAULTS.pfPctOfBasic);
  const [gratuityPctOfBasic, setGratuityPctOfBasic] = useState(COMP_DEFAULTS.gratuityPctOfBasic);
  const [annualBonusPct, setAnnualBonusPct] = useState(COMP_DEFAULTS.annualBonusPct);
  const [bonuses, setBonuses] = useState(DEFAULT_BONUSES);

  const [investments, setInvestments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loans, setLoans] = useState(DEFAULT_LOANS);
  const [rsuGrants, setRsuGrants] = useState(DEFAULT_RSU_GRANTS);

  useEffect(() => {
    (async () => {
      try {
        try {
          const cfg = await window.storage.get("finance-dashboard:config", false);
          if (cfg?.value) {
            const p = JSON.parse(cfg.value);
            if (p.usdInr) setUsdInr(p.usdInr);
            if (typeof p.hikePct === "number") setHikePct(p.hikePct);
            if (p.taxRegime) setTaxRegime(p.taxRegime);
            if (typeof p.monthlyRent === "number") setMonthlyRent(p.monthlyRent);
            if (p.ded) setDed({ ...DEFAULT_DEDUCTIONS, ...p.ded });
            if (typeof p.includeEmployeePF === "boolean") setIncludeEmployeePF(p.includeEmployeePF);
            if (typeof p.sideIncomeMonthly === "number") setSideIncomeMonthly(p.sideIncomeMonthly);
            if (typeof p.spouseIncomeMonthly === "number") setSpouseIncomeMonthly(p.spouseIncomeMonthly);
            if (typeof p.includeRsuInIncome === "boolean") setIncludeRsuInIncome(p.includeRsuInIncome);
            if (typeof p.grossSalary === "number") setGrossSalary(p.grossSalary);
            if (typeof p.basicPct === "number") setBasicPct(p.basicPct);
            if (typeof p.hraPctOfBasic === "number") setHraPctOfBasic(p.hraPctOfBasic);
            if (typeof p.ltaPctOfBasic === "number") setLtaPctOfBasic(p.ltaPctOfBasic);
            if (typeof p.pfPctOfBasic === "number") setPfPctOfBasic(p.pfPctOfBasic);
            if (typeof p.gratuityPctOfBasic === "number") setGratuityPctOfBasic(p.gratuityPctOfBasic);
            if (typeof p.annualBonusPct === "number") setAnnualBonusPct(p.annualBonusPct);
          }
        } catch (e) {}
        try { const r = await window.storage.get("finance-dashboard:bonuses", false); if (r?.value) setBonuses(JSON.parse(r.value)); } catch (e) {}
        try { const r = await window.storage.get("finance-dashboard:investments", false); if (r?.value) setInvestments(JSON.parse(r.value)); } catch (e) {}
        try { const r = await window.storage.get("finance-dashboard:expenses", false); if (r?.value) setExpenses(JSON.parse(r.value)); } catch (e) {}
        try {
          const r = await window.storage.get("finance-dashboard:loans", false);
          const v = r?.value ? JSON.parse(r.value) : null;
          if (Array.isArray(v) && v.length) {
            const defaultIds = new Set(DEFAULT_LOANS.map((l) => l.id));
            const userAdded = v.filter((l) => !defaultIds.has(l.id));
            setLoans([...DEFAULT_LOANS, ...userAdded]);
          }
        } catch (e) {}
        try { const r = await window.storage.get("finance-dashboard:rsuGrants", false); const v = r?.value ? JSON.parse(r.value) : null; if (Array.isArray(v) && v.length) setRsuGrants(v); } catch (e) {}
      } finally { setReady(true); }
    })();
  }, []);

  const persist = useCallback(async (key, value) => {
    try { const res = await window.storage.set(key, JSON.stringify(value), false); setSaveErr(res ? "" : "Couldn't save — changes may not persist."); }
    catch (e) { setSaveErr("Couldn't save — changes may not persist."); }
  }, []);

  useEffect(() => { if (ready) persist("finance-dashboard:config", { usdInr, hikePct, taxRegime, monthlyRent, ded, includeEmployeePF, sideIncomeMonthly, spouseIncomeMonthly, includeRsuInIncome, grossSalary, basicPct, hraPctOfBasic, ltaPctOfBasic, pfPctOfBasic, gratuityPctOfBasic, annualBonusPct }); }, [usdInr, hikePct, taxRegime, monthlyRent, ded, includeEmployeePF, sideIncomeMonthly, spouseIncomeMonthly, includeRsuInIncome, grossSalary, basicPct, hraPctOfBasic, ltaPctOfBasic, pfPctOfBasic, gratuityPctOfBasic, annualBonusPct, ready, persist]);
  useEffect(() => { if (ready) persist("finance-dashboard:bonuses", bonuses); }, [bonuses, ready, persist]);
  useEffect(() => { if (ready) persist("finance-dashboard:investments", investments); }, [investments, ready, persist]);
  useEffect(() => { if (ready) persist("finance-dashboard:expenses", expenses); }, [expenses, ready, persist]);
  useEffect(() => { if (ready) persist("finance-dashboard:loans", loans); }, [loans, ready, persist]);
  useEffect(() => { if (ready) persist("finance-dashboard:rsuGrants", rsuGrants); }, [rsuGrants, ready, persist]);

  /* ---------- deduction totals ---------- */
  const capped = {
    sec80C: Math.min(ded.sec80C, CAPS.sec80C),
    sec80D: Math.min(ded.sec80D, CAPS.sec80D),
    nps80CCD1B: Math.min(ded.nps80CCD1B, CAPS.nps80CCD1B),
    homeLoanInterest: Math.min(ded.homeLoanInterest, CAPS.homeLoanInterest),
  };
  const chapterVIA = capped.sec80C + capped.sec80D + capped.nps80CCD1B;
  const fbpExempt = Number(ded.foodCoupons || 0) + Number(ded.fuelAllowance || 0) + Number(ded.telephone || 0) + Number(ded.otherFbp || 0);

  const compNow = useMemo(() => {
    const basic = grossSalary * (basicPct / 100);
    const hra = basic * (hraPctOfBasic / 100);
    const lta = basic * (ltaPctOfBasic / 100);
    const pf = basic * (pfPctOfBasic / 100);
    const gratuity = basic * (gratuityPctOfBasic / 100);
    return { basic, hra, lta, pf, gratuity, retiralsTotal: pf + gratuity, totalCTC: grossSalary + pf + gratuity };
  }, [grossSalary, basicPct, hraPctOfBasic, ltaPctOfBasic, pfPctOfBasic, gratuityPctOfBasic]);

  /* ---------- full-year tax engine ---------- */
  function taxForYear({ grossSalary: gs, extraIncome, monthsWorked }) {
    const frac = monthsWorked / 12;
    const gross = gs * frac;
    const basic = gross * (basicPct / 100);
    const isOld = taxRegime === "old";
    const rentAnnual = monthlyRent * 12 * frac;
    const hraFull = basic * (hraPctOfBasic / 100);
    const ltaFull = basic * (ltaPctOfBasic / 100);
    const hraEx = isOld ? Math.max(0, Math.min(hraFull, Math.max(0, rentAnnual - 0.10 * basic), 0.40 * basic)) : 0;
    const ltaEx = isOld ? ltaFull : 0;
    const fbpEx = isOld ? fbpExempt * frac : 0;
    const stdDed = isOld ? 50000 : 75000;
    const via = isOld ? chapterVIA : 0;
    const hli = isOld ? capped.homeLoanInterest : 0;
    const taxable = Math.max(0, gross + extraIncome - hraEx - ltaEx - fbpEx - stdDed - via - hli);
    const tax = computeTax(taxable, taxRegime);
    const empPF = includeEmployeePF ? basic * ((pfPctOfBasic || 0) / 100) : 0;
    return {
      gross, extraIncome, hraEx, ltaEx, fbpEx, stdDed, via, hli, taxable,
      tax: tax.total, empPF, net: gross + extraIncome - tax.total - empPF,
    };
  }

  const currentFY = fyOf(new Date());
  const bonusesThisFY = bonuses.filter((b) => b.date && fyOf(new Date(b.date)).start === currentFY.start).reduce((s, b) => s + Number(b.amount || 0), 0);
  const steady = taxForYear({ grossSalary, extraIncome: 0, monthsWorked: 12 });
  const thisFYCalc = taxForYear({ grossSalary, extraIncome: bonusesThisFY, monthsWorked: 12 });
  const netMonthlySteady = steady.net / 12;

  const totalRsuUsd = rsuGrants.reduce((s, g) => s + Number(g.amountUsd || 0), 0);
  const totalRsuInr = totalRsuUsd * usdInr;
  const totalBonusesInr = bonuses.reduce((s, b) => s + Number(b.amount || 0), 0);

  const compBreakdown = [
    { name: "Fixed CTC", value: compNow.totalCTC },
    { name: "One-time Bonuses", value: totalBonusesInr },
    { name: "RSU Grants", value: totalRsuInr },
  ].filter((d) => d.value > 0);

  const totalInvested = investments.reduce((s, i) => s + Number(i.amount || 0), 0);
  const investByType = INVESTMENT_TYPES.map((t) => ({ name: t, value: investments.filter((i) => i.type === t).reduce((s, i) => s + Number(i.amount || 0), 0) })).filter((d) => d.value > 0);
  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const thisMonthKey = new Date().toISOString().slice(0, 7);
  const spentThisMonth = expenses.filter((e) => (e.date || "").slice(0, 7) === thisMonthKey).reduce((s, e) => s + Number(e.amount || 0), 0);
  const spendByCategory = EXPENSE_CATEGORIES.map((c) => ({ name: c, value: expenses.filter((e) => e.category === c).reduce((s, e) => s + Number(e.amount || 0), 0) })).filter((d) => d.value > 0);
  const loanSnaps = useMemo(() => loans.map((l) => ({ loan: l, snap: loanSnapshot(l) })), [loans]);
  const totalMonthlyEmi = loanSnaps.reduce((s, x) => s + x.snap.currentEmi, 0);
  const totalOutstanding = loanSnaps.reduce((s, x) => s + x.snap.balance, 0);
  const avgMonthlyRsu = useMemo(() => {
    const events = rsuGrants.flatMap((g) => generateVestEvents(g));
    const today = new Date();
    const in12 = new Date(today.getFullYear(), today.getMonth() + 12, today.getDate());
    const usd = events.filter((e) => e.date >= today && e.date < in12).reduce((s, e) => s + e.amountUsd, 0);
    return (usd * usdInr) / 12;
  }, [rsuGrants, usdInr]);

  const householdMonthlyIncome = netMonthlySteady + Number(sideIncomeMonthly || 0) + Number(spouseIncomeMonthly || 0) + (includeRsuInIncome ? avgMonthlyRsu : 0);

  /* ---------- monthly cash-flow schedule ---------- */
  const schedule = useMemo(() => {
    const allVestEvents = rsuGrants.flatMap((g) => generateVestEvents(g));
    const today = new Date();
    const scheduleStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const minHorizon = new Date(scheduleStart); minHorizon.setMonth(minHorizon.getMonth() + 36);
    const lastVest = allVestEvents.reduce((max, e) => (e.date > max ? e.date : max), scheduleStart);
    const lastLoanPayoff = loanSnaps.reduce((max, x) => {
      const last = x.snap.rows[x.snap.rows.length - 1];
      return last && last.date > max ? last.date : max;
    }, scheduleStart);
    const horizonEnd = new Date(Math.max(lastVest.getTime(), lastLoanPayoff.getTime(), minHorizon.getTime()));
    const months = [];
    const cursor = new Date(scheduleStart);
    const end = new Date(horizonEnd.getFullYear(), horizonEnd.getMonth(), 1);

    while (cursor <= end) {
      const d = new Date(cursor);
      const key = monthKey(d);
      const items = [];

      const grossThisYear = grossAt(grossSalary, d, hikePct);
      if (grossSalary > 0) {
        const yearCalc = taxForYear({ grossSalary: grossThisYear, extraIncome: 0, monthsWorked: 12 });
        items.push({ label: "Salary (net)", amountInr: yearCalc.net / 12, tag: "cash" });
      }

      bonuses.filter((b) => b.date && monthKey(new Date(b.date)) === key).forEach((b) => {
        items.push({ label: b.name || "Bonus", amountInr: Number(b.amount || 0), tag: "bonus" });
      });

      if (grossSalary > 0 && annualBonusPct > 0 && d.getMonth() === 3) {
        items.push({ label: "Annual Bonus (est.)", amountInr: grossThisYear * (annualBonusPct / 100), tag: "bonus" });
      }

      const byGrant = {};
      allVestEvents.filter((e) => monthKey(e.date) === key).forEach((v) => { byGrant[v.grantName] = (byGrant[v.grantName] || 0) + v.amountUsd; });
      Object.entries(byGrant).forEach(([name, usdAmt]) => {
        items.push({ label: `RSU Vest — ${name}`, amountUsd: usdAmt, amountInr: usdAmt * usdInr, tag: "stock" });
      });

      loanSnaps.forEach(({ loan, snap }) => {
        const row = snap.rows.find((x) => x.key === key);
        if (row) {
          items.push({
            label: `EMI — ${loan.name}`,
            sub: row.disbursed > 0 ? `EMI stepped up — ${INR(row.disbursed)} disbursed` : undefined,
            amountInr: row.emi,
            tag: "outflow",
          });
        }
      });

      const inflowTotal = items.filter((i) => i.tag === "cash" || i.tag === "bonus").reduce((s, i) => s + i.amountInr, 0);
      const outflowTotal = items.filter((i) => i.tag === "outflow").reduce((s, i) => s + i.amountInr, 0);
      const stockTotal = items.filter((i) => i.tag === "stock").reduce((s, i) => s + i.amountInr, 0);
      const cashTotal = inflowTotal - outflowTotal;
      months.push({ key, date: d, label: monthLabel(d), fy: fyOf(d).label, items, inflowTotal, outflowTotal, cashTotal, stockTotal, grandTotal: cashTotal + stockTotal });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [rsuGrants, usdInr, hikePct, taxRegime, monthlyRent, ded, includeEmployeePF, loanSnaps, grossSalary, basicPct, hraPctOfBasic, ltaPctOfBasic, pfPctOfBasic, gratuityPctOfBasic, annualBonusPct, bonuses]);

  return (
    <div className="ldg-body" style={{ minHeight: "100vh", background: T.paper, color: T.ink }}>
      <style>{FONT_CSS}</style>

      <div style={{ background: T.navy, color: T.ink, padding: "28px 24px 22px" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="ldg-mono" style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: T.brass, marginBottom: 6 }}>Finance Ledger</div>
            <h1 className="ldg-display" style={{ fontSize: 32, fontWeight: 600, margin: 0, lineHeight: 1.1 }}>Salary, loans &amp; investments</h1>
            <div style={{ fontSize: 14, color: "#A7ADBB", marginTop: 4 }}>All in one place — nothing leaves your browser</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <Stamp tone="brass"><CalendarClock size={12} /> {fyOf(new Date()).label}</Stamp>
          </div>
        </div>
      </div>

      <div style={{ background: T.paperDim, borderBottom: `1px solid ${T.rule}`, position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", gap: 4, padding: "0 24px", overflowX: "auto" }}>
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className="ldg-mono" style={{ background: "none", border: "none", borderBottom: tab === t.id ? `2.5px solid ${T.brass}` : "2.5px solid transparent", color: tab === t.id ? T.ink : T.inkSoft, fontWeight: tab === t.id ? 600 : 500, fontSize: 11.5, letterSpacing: "0.04em", textTransform: "uppercase", padding: "14px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
        {!ready ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.inkSoft, padding: 40, justifyContent: "center" }}><Loader2 size={18} /> Loading your ledger…</div>
        ) : (
          <>
            {saveErr && <div style={{ background: "rgba(226,87,76,0.12)", border: `1px solid ${T.rust}`, color: T.rust, padding: "8px 12px", borderRadius: 4, fontSize: 12.5, marginBottom: 16 }}>{saveErr}</div>}

            {tab === "overview" && <Overview {...{ netMonthlySteady, householdMonthlyIncome, sideIncomeMonthly, spouseIncomeMonthly, totalInvested, spentThisMonth, totalMonthlyEmi, totalOutstanding, compBreakdown }} />}
            {tab === "schedule" && <Schedule {...{ schedule, rsuGrants, setRsuGrants, usdInr, setUsdInr, hikePct, setHikePct }} />}
            {tab === "salary" && <SalaryLedger {...{ usdInr, setUsdInr, totalRsuInr, taxRegime, setTaxRegime, monthlyRent, setMonthlyRent, ded, setDed, capped, chapterVIA, fbpExempt, includeEmployeePF, setIncludeEmployeePF, steady, netMonthlySteady, thisFYCalc, bonusesThisFY, currentFY, hikePct, setHikePct, grossSalary, setGrossSalary, basicPct, setBasicPct, hraPctOfBasic, setHraPctOfBasic, ltaPctOfBasic, setLtaPctOfBasic, pfPctOfBasic, setPfPctOfBasic, gratuityPctOfBasic, setGratuityPctOfBasic, annualBonusPct, setAnnualBonusPct, compNow, bonuses, setBonuses }} />}
            {tab === "income" && <HouseholdIncome {...{ netMonthlySteady, sideIncomeMonthly, setSideIncomeMonthly, spouseIncomeMonthly, setSpouseIncomeMonthly, avgMonthlyRsu, includeRsuInIncome, setIncludeRsuInIncome, householdMonthlyIncome }} />}
            {tab === "investments" && <Investments {...{ investments, setInvestments, totalInvested, investByType }} />}
            {tab === "loans" && <Loans {...{ loans, setLoans, loanSnaps, totalMonthlyEmi, totalOutstanding }} />}
            {tab === "expenses" && <Expenses {...{ expenses, setExpenses, totalSpent, spentThisMonth, spendByCategory }} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- OVERVIEW ---------------- */
function Overview({ netMonthlySteady, householdMonthlyIncome, sideIncomeMonthly, spouseIncomeMonthly, totalInvested, spentThisMonth, totalMonthlyEmi, totalOutstanding, compBreakdown }) {
  const freeCash = householdMonthlyIncome - totalMonthlyEmi - spentThisMonth;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 14 }}>
        <StatCard icon={Wallet} label="Take-Home (Monthly)" value={INR_L(netMonthlySteady)} note="Post-tax, post employee PF" />
        <StatCard icon={Users} label="Household Income" value={INR_L(householdMonthlyIncome)} tone={T.moss} note={sideIncomeMonthly || spouseIncomeMonthly ? "Incl. side + spouse income" : "Side & spouse income: ₹0"} />
        <StatCard icon={CreditCard} label="EMI Outgo (Monthly)" value={INR_L(totalMonthlyEmi)} tone={T.rust} note={`${INR_L(totalOutstanding)} outstanding`} />
        <StatCard icon={Receipt} label="Spent This Month" value={INR_L(spentThisMonth)} tone={T.rust} note="Logged in Spends" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 20 }}>
        <StatCard icon={PiggyBank} label="Total Invested" value={INR_L(totalInvested)} tone={T.moss} note="Logged in Investments" />
        <StatCard icon={TrendingUp} label="Free Cash This Month" value={INR_L(freeCash)} tone={freeCash >= 0 ? T.moss : T.rust} note="Income − EMIs − logged spends" />
      </div>
      <Card>
        <h3 className="ldg-display" style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>Compensation Mix</h3>
        <p style={{ fontSize: 12.5, color: T.inkSoft, margin: "0 0 16px" }}>Fixed pay, one-time bonuses, and RSU grants (pre-tax).</p>
        {compBreakdown.length === 0 ? (
          <EmptyState text="Enter your salary in Salary & Tax to see the mix." />
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
            <div style={{ width: 220, height: 220, flexShrink: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={compBreakdown} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                    {compBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke={T.card} strokeWidth={2} />)}
                  </Pie>
                  <Tooltip formatter={(v) => INR_L(v)} contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12, borderRadius: 6, border: `1px solid ${T.rule}` }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              {compBreakdown.map((d, i) => (
                <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${T.rule}` }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, flex: 1 }}>{d.name}</span>
                  <span className="ldg-mono" style={{ fontSize: 13, fontWeight: 600 }}>{INR_L(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- MONTHLY SCHEDULE ---------------- */
function Schedule({ schedule, rsuGrants, setRsuGrants, usdInr, setUsdInr, hikePct, setHikePct }) {
  const years = useMemo(() => [...new Set(schedule.map((m) => m.date.getFullYear()))], [schedule]);
  const [year, setYear] = useState(years[0] || new Date().getFullYear());
  const [showGrants, setShowGrants] = useState(false);

  const monthsThisYear = schedule.filter((m) => m.date.getFullYear() === year);
  const yearInflow = monthsThisYear.reduce((s, m) => s + m.inflowTotal, 0);
  const yearOutflow = monthsThisYear.reduce((s, m) => s + m.outflowTotal, 0);
  const yearCash = monthsThisYear.reduce((s, m) => s + m.cashTotal, 0);
  const yearStock = monthsThisYear.reduce((s, m) => s + m.stockTotal, 0);
  const today = new Date();
  const next = schedule.flatMap((m) => m.items.map((i) => ({ ...i, date: m.date, monthLabel: m.label })))
    .filter((i) => i.date >= new Date(today.getFullYear(), today.getMonth(), 1) && (i.tag === "bonus" || i.tag === "stock" || i.tag === "outflow"))
    .sort((a, b) => a.date - b.date)[0];

  const [form, setForm] = useState({ name: "", amountUsd: "", grantDate: new Date().toISOString().slice(0, 10), vestYears: 4, frequency: "quarterly" });
  const addGrant = () => {
    if (!form.name.trim() || !form.amountUsd) return;
    setRsuGrants((prev) => [...prev, { id: uid(), ...form, amountUsd: Number(form.amountUsd), vestYears: Number(form.vestYears) }]);
    setForm({ name: "", amountUsd: "", grantDate: new Date().toISOString().slice(0, 10), vestYears: 4, frequency: "quarterly" });
  };

  return (
    <div>
      {next && (
        <Card style={{ marginBottom: 16, borderColor: T.brass, background: "rgba(212,175,55,0.10)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ArrowRight size={16} color={T.brassDeep} />
            <div style={{ flex: 1 }}>
              <div className="ldg-mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.brassDeep }}>Next Up</div>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{next.label} · {next.monthLabel}</div>
            </div>
            <div className="ldg-mono" style={{ fontSize: 16, fontWeight: 700, color: next.tag === "outflow" ? T.rust : T.brassDeep }}>{next.tag === "outflow" ? "− " : ""}{INR(next.amountInr)}</div>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 18 }}>
        <StatCard icon={Wallet} label={`${year} Inflow`} value={INR_L(yearInflow)} note="Salary + bonuses" />
        <StatCard icon={CreditCard} label={`${year} Outflow`} value={INR_L(yearOutflow)} tone={T.rust} note="EMIs + property installments" />
        <StatCard icon={TrendingUp} label={`${year} Net Cash`} value={INR_L(yearCash)} tone={yearCash >= 0 ? T.moss : T.rust} />
        <StatCard icon={Layers} label={`${year} Stock Vesting`} value={INR_L(yearStock)} tone={T.moss} note="At current USD/INR rate" />
      </div>

      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16, paddingBottom: 4 }}>
        {years.map((y) => (
          <button key={y} onClick={() => setYear(y)} className="ldg-mono" style={{ background: y === year ? T.navy : "transparent", color: y === year ? T.ink : T.inkSoft, border: `1px solid ${T.navy}`, borderRadius: 20, padding: "6px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>{y}</button>
        ))}
      </div>

      {monthsThisYear.map((m) => {
        const isPast = m.date < new Date(today.getFullYear(), today.getMonth(), 1);
        return (
          <Card key={m.key} style={{ marginBottom: 14, opacity: isPast ? 0.6 : 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <h4 className="ldg-display" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{m.label}<span className="ldg-mono" style={{ fontSize: 10.5, color: T.inkSoft, marginLeft: 8, fontWeight: 400 }}>{m.fy}</span></h4>
              {sameMonth(m.date, today) && <Stamp tone="brass">This Month</Stamp>}
            </div>
            {m.items.map((it, idx) => (
              <LedgerRow key={idx} label={it.label} sub={it.amountUsd ? `≈ ${USD(it.amountUsd)}` : it.sub} value={`${it.tag === "outflow" ? "− " : ""}${INR(it.amountInr)}`} tone={it.tag === "stock" ? T.moss : it.tag === "bonus" ? T.brassDeep : it.tag === "outflow" ? T.rust : T.ink} />
            ))}
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1.5px solid ${T.ink}`, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4 }}>
              <span className="ldg-mono" style={{ fontSize: 12, color: T.inkSoft }}>
                In: {INR(m.inflowTotal)}{m.outflowTotal > 0 ? ` · Out: ${INR(m.outflowTotal)}` : ""}{m.stockTotal > 0 ? ` · Stock: ${INR(m.stockTotal)}` : ""}
              </span>
              <span className="ldg-mono" style={{ fontSize: 15, fontWeight: 700, color: m.cashTotal < 0 ? T.rust : T.ink }}>Net {INR(m.cashTotal)}</span>
            </div>
          </Card>
        );
      })}

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setShowGrants((s) => !s)}>
          <h3 className="ldg-display" style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Assumptions — Grants, FX, Hike</h3>
          <span className="ldg-mono" style={{ fontSize: 12, color: T.brass }}>{showGrants ? "Hide" : "Edit"}</span>
        </div>
        {showGrants && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <Field label="USD / INR rate"><input type="number" value={usdInr} onChange={(e) => setUsdInr(Number(e.target.value) || 0)} style={inputStyle} /></Field>
              <Field label="Annual hike %" hint="Applied each April from 2027"><input type="number" value={hikePct} onChange={(e) => setHikePct(Number(e.target.value) || 0)} style={inputStyle} /></Field>
            </div>
            {rsuGrants.map((g) => (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.rule}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{g.name}</div>
                  <div style={{ fontSize: 11, color: T.inkSoft }}>{USD(g.amountUsd)} · granted {g.grantDate} · {g.vestYears}y {g.frequency}</div>
                </div>
                <button onClick={() => setRsuGrants((prev) => prev.filter((x) => x.id !== g.id))} style={iconBtnStyle}><Trash2 size={14} /></button>
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 1fr 0.7fr 1fr auto", gap: 8, marginTop: 12, alignItems: "end" }}>
              <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Refresher 2028" style={inputStyle} /></Field>
              <Field label="USD"><input type="number" value={form.amountUsd} onChange={(e) => setForm({ ...form, amountUsd: e.target.value })} style={inputStyle} /></Field>
              <Field label="Grant Date"><input type="date" value={form.grantDate} onChange={(e) => setForm({ ...form, grantDate: e.target.value })} style={inputStyle} /></Field>
              <Field label="Years"><input type="number" value={form.vestYears} onChange={(e) => setForm({ ...form, vestYears: e.target.value })} style={inputStyle} /></Field>
              <Field label="Frequency"><select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} style={inputStyle}><option value="quarterly">Quarterly</option><option value="monthly">Monthly</option></select></Field>
              <button onClick={addGrant} style={addBtnStyle}><Plus size={16} /></button>
            </div>
          </div>
        )}
        <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 14, marginBottom: 0, lineHeight: 1.5 }}>
          Grants vest in equal instalments with no cliff, first vest one period after the grant date. Annual bonus is estimated every April; one-time bonuses land in whichever month you set. RSU values are pre-tax — vesting is taxed as a perquisite in the vest month. Loan EMIs are the outflows shown — if a lender is disbursing directly to a builder for a construction-linked loan, add those tranches under that loan's disbursements instead of logging them separately, so they raise the EMI rather than double-counting as a cash outflow.
        </p>
      </Card>
    </div>
  );
}

/* ---------------- SALARY & TAX ---------------- */
function SalaryLedger(props) {
  const {
    usdInr, setUsdInr, totalRsuInr, taxRegime, setTaxRegime, monthlyRent, setMonthlyRent, ded, setDed,
    capped, chapterVIA, fbpExempt, includeEmployeePF, setIncludeEmployeePF, steady, netMonthlySteady,
    thisFYCalc, bonusesThisFY, currentFY, hikePct, setHikePct,
    grossSalary, setGrossSalary, basicPct, setBasicPct, hraPctOfBasic, setHraPctOfBasic,
    ltaPctOfBasic, setLtaPctOfBasic, pfPctOfBasic, setPfPctOfBasic, gratuityPctOfBasic, setGratuityPctOfBasic,
    annualBonusPct, setAnnualBonusPct, compNow, bonuses, setBonuses,
  } = props;
  const set = (k) => (e) => setDed({ ...ded, [k]: Number(e.target.value) || 0 });
  const [bonusForm, setBonusForm] = useState({ name: "", amount: "", date: new Date().toISOString().slice(0, 10) });

  const addBonus = () => {
    if (!bonusForm.name.trim() || !bonusForm.amount) return;
    setBonuses((p) => [{ id: uid(), name: bonusForm.name, amount: Number(bonusForm.amount), date: bonusForm.date }, ...p]);
    setBonusForm({ name: "", amount: "", date: new Date().toISOString().slice(0, 10) });
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 className="ldg-display" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Your Compensation</h3>
          <Stamp tone="moss">Per Annum</Stamp>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
          <Field label="Gross Salary (₹/yr)"><input type="number" value={grossSalary || ""} onChange={(e) => setGrossSalary(Number(e.target.value) || 0)} placeholder="e.g. 2500000" style={inputStyle} /></Field>
          <Field label="Basic Pay (% of gross)"><input type="number" value={basicPct} onChange={(e) => setBasicPct(Number(e.target.value) || 0)} style={inputStyle} /></Field>
          <Field label="HRA (% of basic)"><input type="number" value={hraPctOfBasic} onChange={(e) => setHraPctOfBasic(Number(e.target.value) || 0)} style={inputStyle} /></Field>
          <Field label="LTA (% of basic)"><input type="number" value={ltaPctOfBasic} onChange={(e) => setLtaPctOfBasic(Number(e.target.value) || 0)} style={inputStyle} /></Field>
          <Field label="Employer PF (% of basic)"><input type="number" value={pfPctOfBasic} onChange={(e) => setPfPctOfBasic(Number(e.target.value) || 0)} style={inputStyle} /></Field>
          <Field label="Gratuity (% of basic)"><input type="number" value={gratuityPctOfBasic} onChange={(e) => setGratuityPctOfBasic(Number(e.target.value) || 0)} style={inputStyle} /></Field>
        </div>

        {grossSalary > 0 ? (
          <>
            <LedgerRow bold label="Gross Salary" value={INR(grossSalary)} />
            <LedgerRow indent label="Basic Pay" sub={`${basicPct}% of gross`} value={INR(compNow.basic)} />
            <LedgerRow indent label="House Rent Allowance" sub={`${hraPctOfBasic}% of basic`} value={INR(compNow.hra)} />
            <LedgerRow indent label="Leave Travel Allowance" sub={`${ltaPctOfBasic}% of basic`} value={INR(compNow.lta)} />
            <LedgerRow label="Employer PF Contribution" sub={`${pfPctOfBasic}% of basic`} value={INR(compNow.pf)} />
            <LedgerRow label="Gratuity" sub={`${gratuityPctOfBasic}% of basic`} value={INR(compNow.gratuity)} />
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `2px solid ${T.ink}`, display: "flex", justifyContent: "space-between" }}>
              <span className="ldg-display" style={{ fontSize: 16, fontWeight: 600 }}>Total Fixed CTC</span>
              <span className="ldg-mono" style={{ fontSize: 20, fontWeight: 700, color: T.brassDeep }}>{INR(compNow.totalCTC)}</span>
            </div>
          </>
        ) : (
          <EmptyState text="Enter your gross salary above to see the full breakup." />
        )}
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 className="ldg-display" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Bonuses &amp; Stock</h3>
          <label className="ldg-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.inkSoft }}>
            annual bonus
            <input type="number" value={annualBonusPct} onChange={(e) => setAnnualBonusPct(Number(e.target.value) || 0)} style={{ width: 46, border: `1px solid ${T.rule}`, borderRadius: 4, padding: "3px 5px", fontSize: 12, background: T.paper }} /> % of gross
          </label>
        </div>
        <LedgerRow label="Annual Bonus (est.)" sub="paid each April" value={INR(grossSalary * (annualBonusPct / 100))} />

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.rule}` }}>
          <div className="ldg-mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.inkSoft, marginBottom: 10 }}>One-time bonuses — sign-on, relocation, retention, etc.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 10, alignItems: "end", marginBottom: 12 }}>
            <Field label="Name"><input value={bonusForm.name} onChange={(e) => setBonusForm({ ...bonusForm, name: e.target.value })} placeholder="e.g. Sign-on bonus" style={inputStyle} /></Field>
            <Field label="Amount (₹)"><input type="number" value={bonusForm.amount} onChange={(e) => setBonusForm({ ...bonusForm, amount: e.target.value })} style={inputStyle} /></Field>
            <Field label="Month &amp; Year"><input type="date" value={bonusForm.date} onChange={(e) => setBonusForm({ ...bonusForm, date: e.target.value })} style={inputStyle} /></Field>
            <button onClick={addBonus} style={addBtnStyle}><Plus size={16} /> Add</button>
          </div>
          {bonuses.length === 0 ? <EmptyState text="No one-time bonuses added yet." /> : bonuses.map((b) => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.rule}` }}>
              <div style={{ flex: 1, fontSize: 13.5 }}>{b.name}<span style={{ fontSize: 11, color: T.inkSoft, marginLeft: 6 }}>{b.date}</span></div>
              <span className="ldg-mono" style={{ fontSize: 13, fontWeight: 600, color: T.brassDeep }}>{INR(b.amount)}</span>
              <button onClick={() => setBonuses((p) => p.filter((x) => x.id !== b.id))} style={iconBtnStyle}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 0", marginTop: 12, borderTop: `1px solid ${T.rule}`, gap: 10 }}>
          <div>
            <div style={{ fontSize: 14 }}>RSU Grants (total)</div>
            <div style={{ fontSize: 11, color: T.inkSoft, fontStyle: "italic" }}>set up in the Monthly Schedule tab</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="ldg-mono" style={{ fontSize: 11, color: T.inkSoft }}>@ ₹</span>
            <input type="number" value={usdInr} onChange={(e) => setUsdInr(Number(e.target.value) || 0)} className="ldg-mono" style={{ width: 56, border: `1px solid ${T.rule}`, borderRadius: 4, padding: "3px 5px", fontSize: 12, background: T.paper }} />
          </div>
          <span className="ldg-mono" style={{ fontSize: 14, fontWeight: 500 }}>{INR(totalRsuInr)}</span>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <h3 className="ldg-display" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Before Tax → After Tax</h3>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setTaxRegime("new")} style={{ ...addBtnStyle, background: taxRegime === "new" ? T.navy : "transparent", color: taxRegime === "new" ? T.ink : T.inkSoft, border: `1px solid ${T.navy}`, padding: "6px 12px", fontSize: 11.5 }}>New Regime</button>
            <button onClick={() => setTaxRegime("old")} style={{ ...addBtnStyle, background: taxRegime === "old" ? T.navy : "transparent", color: taxRegime === "old" ? T.ink : T.inkSoft, border: `1px solid ${T.navy}`, padding: "6px 12px", fontSize: 11.5 }}>Old Regime</button>
          </div>
        </div>

        {taxRegime === "old" ? (
          <div style={{ background: T.paperDim, border: `1px solid ${T.rule}`, borderRadius: 6, padding: 16, marginBottom: 16 }}>
            <div className="ldg-mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.brassDeep, marginBottom: 12 }}>Old Regime Deductions &amp; Exemptions</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <Field label="Monthly Rent Paid" hint="drives HRA exemption"><input type="number" value={monthlyRent} onChange={(e) => setMonthlyRent(Number(e.target.value) || 0)} style={inputStyle} /></Field>
              <Field label="80C — PF, ELSS, insurance" hint={`capped at ${INR(CAPS.sec80C)}`}><input type="number" value={ded.sec80C} onChange={set("sec80C")} style={inputStyle} /></Field>
              <Field label="80D — health insurance" hint={`capped at ${INR(CAPS.sec80D)}`}><input type="number" value={ded.sec80D} onChange={set("sec80D")} style={inputStyle} /></Field>
              <Field label="80CCD(1B) — NPS" hint={`capped at ${INR(CAPS.nps80CCD1B)}`}><input type="number" value={ded.nps80CCD1B} onChange={set("nps80CCD1B")} style={inputStyle} /></Field>
              <Field label="Home loan interest — Sec 24(b)" hint={`self-occupied cap ${INR(CAPS.homeLoanInterest)}`}><input type="number" value={ded.homeLoanInterest} onChange={set("homeLoanInterest")} style={inputStyle} /></Field>
              <Field label="Food coupons / meal card" hint="₹50/meal ≈ ₹26,400 a year"><input type="number" value={ded.foodCoupons} onChange={set("foodCoupons")} style={inputStyle} /></Field>
              <Field label="Fuel &amp; driver allowance"><input type="number" value={ded.fuelAllowance} onChange={set("fuelAllowance")} style={inputStyle} /></Field>
              <Field label="Telephone / internet"><input type="number" value={ded.telephone} onChange={set("telephone")} style={inputStyle} /></Field>
              <Field label="Other FBP components"><input type="number" value={ded.otherFbp} onChange={set("otherFbp")} style={inputStyle} /></Field>
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.rule}`, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span className="ldg-mono" style={{ fontSize: 12, color: T.inkSoft }}>Chapter VI-A: {INR(chapterVIA)} · Home loan: {INR(capped.homeLoanInterest)} · FBP exempt: {INR(fbpExempt)}</span>
              <span className="ldg-mono" style={{ fontSize: 13, fontWeight: 700, color: T.moss }}>Total {INR(chapterVIA + capped.homeLoanInterest + fbpExempt)}</span>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 0, marginBottom: 16 }}>
            New regime — flat ₹75,000 standard deduction, no HRA/LTA/80C. Switch to Old Regime to enter your deductions.
          </p>
        )}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <label className="ldg-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.inkSoft, cursor: "pointer" }}>
            <input type="checkbox" checked={includeEmployeePF} onChange={(e) => setIncludeEmployeePF(e.target.checked)} /> deduct employee PF ({pfPctOfBasic}% of basic)
          </label>
          <label className="ldg-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.inkSoft }}>
            annual hike
            <input type="number" value={hikePct} onChange={(e) => setHikePct(Number(e.target.value) || 0)} style={{ width: 50, border: `1px solid ${T.rule}`, borderRadius: 4, padding: "3px 5px", fontSize: 12, background: T.paper }} /> %
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
          <YearColumn title="Steady State — Full Year" calc={steady} footLabel="Net Monthly Take-Home" footValue={INR(netMonthlySteady)} footTone={T.moss} />
          <YearColumn title={`${currentFY.label} — incl. bonuses`} calc={thisFYCalc} extraLabel="One-time bonuses this FY" footLabel="Net Cash This FY" footValue={INR(thisFYCalc.net)} footTone={T.brassDeep} />
        </div>

        <p style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 16, marginBottom: 0, lineHeight: 1.5 }}>
          Estimates using FY2026-27 slabs as currently known, standard deduction, surcharge and 4% cess. RSU perquisite tax is not included here — that's taxed separately at each vest. Not a substitute for advice from a CA.
        </p>
      </Card>
    </div>
  );
}

function YearColumn({ title, calc, extraLabel, footLabel, footValue, footTone }) {
  return (
    <div>
      <div className="ldg-mono" style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: T.brass, marginBottom: 8 }}>{title}</div>
      <LedgerRow label="Gross Salary" value={INR(calc.gross)} />
      {calc.extraIncome > 0 && <LedgerRow label={extraLabel || "Bonuses"} value={INR(calc.extraIncome)} />}
      {calc.hraEx > 0 && <LedgerRow label="− HRA exemption" value={INR(calc.hraEx)} />}
      {calc.fbpEx > 0 && <LedgerRow label="− FBP exemptions" value={INR(calc.fbpEx)} />}
      {calc.via > 0 && <LedgerRow label="− Chapter VI-A" value={INR(calc.via)} />}
      {calc.hli > 0 && <LedgerRow label="− Home loan interest" value={INR(calc.hli)} />}
      <LedgerRow label="Taxable Income" value={INR(calc.taxable)} />
      <LedgerRow label="Tax + Cess" value={INR(calc.tax)} tone={T.rust} />
      <LedgerRow label="Employee PF" value={INR(calc.empPF)} />
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: `2px solid ${T.ink}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="ldg-display" style={{ fontSize: 14, fontWeight: 600 }}>{footLabel}</span>
        <span className="ldg-mono" style={{ fontSize: 17, fontWeight: 700, color: footTone }}>{footValue}</span>
      </div>
    </div>
  );
}

/* ---------------- HOUSEHOLD INCOME ---------------- */
function HouseholdIncome({ netMonthlySteady, sideIncomeMonthly, setSideIncomeMonthly, spouseIncomeMonthly, setSpouseIncomeMonthly, avgMonthlyRsu, includeRsuInIncome, setIncludeRsuInIncome, householdMonthlyIncome }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 20 }}>
        <StatCard icon={Wallet} label="Your Salary (Take-Home)" value={INR_L(netMonthlySteady)} note="per month, post-tax" />
        <StatCard icon={Layers} label="RSU Vesting (avg)" value={INR_L(avgMonthlyRsu)} tone={T.moss} note="monthly-equiv., vests quarterly" />
        <StatCard icon={TrendingUp} label="Side Income" value={INR_L(sideIncomeMonthly)} note="per month" />
        <StatCard icon={Users} label="Spouse's Income" value={INR_L(spouseIncomeMonthly)} note="per month" />
      </div>

      <Card style={{ marginBottom: 20, background: "rgba(212,175,55,0.10)", border: `1px solid ${T.brass}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="ldg-mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.brassDeep, marginBottom: 4 }}>RSUs vest quarterly, not monthly</div>
            <p style={{ fontSize: 12.5, color: T.inkSoft, margin: 0, maxWidth: 520 }}>
              {INR_L(avgMonthlyRsu)}/month is your RSU value spread evenly across the next 12 months so it's comparable to salary — the real cash lands in lumps each quarter (see the Monthly Schedule tab for exact dates). Pre-tax; vesting is taxed as a perquisite.
            </p>
          </div>
          <label className="ldg-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft, cursor: "pointer", flexShrink: 0 }}>
            <input type="checkbox" checked={includeRsuInIncome} onChange={(e) => setIncludeRsuInIncome(e.target.checked)} /> include in total below
          </label>
        </div>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="ldg-display" style={{ fontSize: 16, fontWeight: 600 }}>Total Household Income</span>
          <span className="ldg-mono" style={{ fontSize: 24, fontWeight: 700, color: T.moss }}>{INR_L(householdMonthlyIncome)}</span>
        </div>
        <div className="ldg-mono" style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 4 }}>per month{includeRsuInIncome ? " · includes averaged RSU" : " · RSU excluded"}</div>
      </Card>

      <Card>
        <h3 className="ldg-display" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 6px" }}>Other Income Sources</h3>
        <p style={{ fontSize: 12.5, color: T.inkSoft, margin: "0 0 16px" }}>Both currently ₹0 — update anytime these become active.</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Your Side Income (monthly, ₹)"><input type="number" value={sideIncomeMonthly} onChange={(e) => setSideIncomeMonthly(Number(e.target.value) || 0)} style={inputStyle} /></Field>
          <Field label="Spouse's Income (monthly, ₹)"><input type="number" value={spouseIncomeMonthly} onChange={(e) => setSpouseIncomeMonthly(Number(e.target.value) || 0)} style={inputStyle} /></Field>
        </div>
      </Card>
    </div>
  );
}

/* ---------------- INVESTMENTS ---------------- */
function Investments({ investments, setInvestments, totalInvested, investByType }) {
  const [form, setForm] = useState({ name: "", type: INVESTMENT_TYPES[0], amount: "", date: new Date().toISOString().slice(0, 10), repeat: false, repeatMonths: 12 });

  const add = () => {
    if (!form.name.trim() || !form.amount) return;
    if (form.repeat) {
      const seriesId = uid();
      const n = Math.max(1, Number(form.repeatMonths) || 12);
      const base = new Date(form.date);
      const entries = [];
      for (let i = 0; i < n; i++) {
        const d = new Date(base.getFullYear(), base.getMonth() + i, base.getDate());
        entries.push({ id: uid(), name: form.name, type: form.type, amount: Number(form.amount), date: d.toISOString().slice(0, 10), seriesId, seriesIndex: i + 1, seriesCount: n });
      }
      setInvestments((p) => [...entries, ...p]);
    } else {
      setInvestments((p) => [{ id: uid(), name: form.name, type: form.type, amount: Number(form.amount), date: form.date }, ...p]);
    }
    setForm({ name: form.name, type: form.type, amount: "", date: new Date().toISOString().slice(0, 10), repeat: form.repeat, repeatMonths: form.repeatMonths });
  };

  const removeSeries = (seriesId) => setInvestments((p) => p.filter((x) => x.seriesId !== seriesId));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
        <StatCard icon={PiggyBank} label="Total Invested" value={INR_L(totalInvested)} tone={T.moss} />
        <StatCard icon={TrendingUp} label="Entries Logged" value={investments.length} />
        <StatCard icon={Landmark} label="Asset Classes" value={investByType.length} />
      </div>
      <Card style={{ marginBottom: 20 }}>
        <h3 className="ldg-display" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 14px" }}>Log an Investment</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Parag Parikh Flexi Cap" style={inputStyle} /></Field>
          <Field label="Type"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inputStyle}>{INVESTMENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Amount (₹)"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} /></Field>
          <Field label={form.repeat ? "Starts" : "Date"}><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inputStyle} /></Field>
          <button onClick={add} style={addBtnStyle}><Plus size={16} /> Add</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
          <label className="ldg-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft, cursor: "pointer" }}>
            <input type="checkbox" checked={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.checked })} />
            repeats monthly — like a SIP
          </label>
          {form.repeat && (
            <label className="ldg-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft }}>
              for
              <input type="number" min="1" value={form.repeatMonths} onChange={(e) => setForm({ ...form, repeatMonths: e.target.value })} style={{ width: 56, border: `1px solid ${T.rule}`, borderRadius: 4, padding: "3px 5px", fontSize: 12, background: T.paper }} />
              months
            </label>
          )}
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20 }}>
        <Card>
          <h3 className="ldg-display" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 10px" }}>Entries</h3>
          {investments.length === 0 ? <EmptyState text="No investments logged yet." /> : investments.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.rule}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {i.name}
                  {i.seriesId && <span className="ldg-mono" style={{ fontSize: 10, color: T.brass, marginLeft: 6 }}>↻ {i.seriesIndex}/{i.seriesCount}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: T.inkSoft }}>{i.type} · {i.date}</div>
              </div>
              <span className="ldg-mono" style={{ fontSize: 14, fontWeight: 600, color: T.moss }}>{INR(i.amount)}</span>
              {i.seriesId ? (
                <button onClick={() => removeSeries(i.seriesId)} style={iconBtnStyle} title="Delete whole series"><Trash2 size={14} /></button>
              ) : (
                <button onClick={() => setInvestments((p) => p.filter((x) => x.id !== i.id))} style={iconBtnStyle}><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </Card>
        <Card>
          <h3 className="ldg-display" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 10px" }}>Allocation</h3>
          {investByType.length === 0 ? <EmptyState text="Allocation appears once you log entries." /> : (
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={investByType} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {investByType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke={T.card} strokeWidth={2} />)}
                  </Pie>
                  <Tooltip formatter={(v) => INR_L(v)} contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12, borderRadius: 6, border: `1px solid ${T.rule}` }} />
                  <Legend wrapperStyle={{ fontSize: 11.5, fontFamily: "Inter" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------- LOANS ---------------- */
function Loans({ loans, setLoans, loanSnaps, totalMonthlyEmi, totalOutstanding }) {
  const [form, setForm] = useState({ name: "", type: LOAN_TYPES[0], principal: "", rate: "", tenureMonths: "", emi: "", startDate: new Date().toISOString().slice(0, 10) });
  const [openId, setOpenId] = useState(null);
  const [prepayOpenId, setPrepayOpenId] = useState(null);
  const [prepayForm, setPrepayForm] = useState({ amount: "", date: new Date().toISOString().slice(0, 10) });

  const previewEmi = form.principal && form.tenureMonths
    ? emi(Number(form.principal), Number(form.rate) || 0, Number(form.tenureMonths))
    : 0;

  const add = () => {
    if (!form.name.trim() || !form.principal) return;
    setLoans((p) => [...p, {
      id: uid(), name: form.name, type: form.type, principal: Number(form.principal), rate: Number(form.rate) || 0,
      tenureMonths: Number(form.tenureMonths) || 240, emi: Number(form.emi) || 0, startDate: form.startDate, prepayments: [],
    }]);
    setForm({ name: "", type: form.type, principal: "", rate: "", tenureMonths: "", emi: "", startDate: new Date().toISOString().slice(0, 10) });
  };

  const addPrepayment = (loanId) => {
    if (!prepayForm.amount) return;
    setLoans((prev) => prev.map((l) => l.id === loanId
      ? { ...l, prepayments: [...(l.prepayments || []), { id: uid(), amount: Number(prepayForm.amount), date: prepayForm.date }] }
      : l));
    setPrepayForm({ amount: "", date: new Date().toISOString().slice(0, 10) });
  };

  const removePrepayment = (loanId, prepayId) => {
    setLoans((prev) => prev.map((l) => l.id === loanId
      ? { ...l, prepayments: (l.prepayments || []).filter((pp) => pp.id !== prepayId) }
      : l));
  };

  const totalInterest = loanSnaps.reduce((s, x) => s + x.snap.totalInterest, 0);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 20 }}>
        <StatCard icon={CreditCard} label="Monthly EMI Outgo" value={INR_L(totalMonthlyEmi)} tone={T.rust} note="Current month, all loans" />
        <StatCard icon={TrendingDown} label="Outstanding Principal" value={INR_L(totalOutstanding)} />
        <StatCard icon={Landmark} label="Lifetime Interest" value={INR_L(totalInterest)} note="Over full tenure, at current rates" />
        <StatCard icon={Layers} label="Active Loans" value={loans.length} />
      </div>

      {loanSnaps.map(({ loan, snap }) => {
        const open = openId === loan.id;
        const prepayOpen = prepayOpenId === loan.id;
        const stepUps = snap.rows.filter((r) => r.disbursed > 0);
        const prepayList = loan.prepayments || [];
        return (
          <Card key={loan.id} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="ldg-display" style={{ fontSize: 16, fontWeight: 600 }}>{loan.name}</div>
                <div style={{ fontSize: 11.5, color: T.inkSoft, marginTop: 2 }}>
                  {loan.type ? `${loan.type} · ` : ""}{loan.rate}% p.a. · opened {loan.startDate} · {snap.monthsLeft} EMIs left
                  {snap.payoffDate ? ` · closes ${monthLabel(snap.payoffDate)}` : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="ldg-mono" style={{ fontSize: 18, fontWeight: 700, color: T.rust }}>{INR(snap.currentEmi)}</div>
                <div style={{ fontSize: 11, color: T.inkSoft }}>current EMI</div>
              </div>
              <button onClick={() => setLoans((p) => p.filter((x) => x.id !== loan.id))} style={iconBtnStyle} aria-label="Remove loan"><Trash2 size={14} /></button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.rule}` }}>
              <MiniStat label="Outstanding" value={INR_L(snap.balance)} />
              <MiniStat label="Original Principal" value={INR_L(loan.principal)} />
              <MiniStat label="Interest Over Life" value={INR_L(snap.totalInterest)} tone={T.rust} />
              {stepUps.length > 0 && <MiniStat label="Future Disbursements" value={String(stepUps.length)} tone={T.brassDeep} />}
            </div>

            {snap.payoffDate && loan.statedTenureMonths && snap.rows.length > loan.statedTenureMonths && (
              <div style={{ marginTop: 12, background: "rgba(212,175,55,0.10)", border: `1px solid ${T.brass}`, borderRadius: 6, padding: "10px 14px" }}>
                <span className="ldg-mono" style={{ fontSize: 11.5, color: T.brassDeep }}>
                  ⌓ Loan paperwork states a {loan.statedTenureMonths}-month tenure, but at the current EMI it actually takes {snap.rows.length} installments to pay off — closing around {monthLabel(snap.payoffDate)}, not the originally stated end date.
                </span>
              </div>
            )}

            {stepUps.length > 0 && (
              <div style={{ marginTop: 14, background: T.paperDim, border: `1px solid ${T.rule}`, borderRadius: 6, padding: 14 }}>
                <div className="ldg-mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.brassDeep, marginBottom: 4 }}>Projected EMI Step-Up</div>
                <p style={{ fontSize: 11.5, color: T.inkSoft, margin: "0 0 10px", lineHeight: 1.5 }}>
                  Each builder installment is disbursed by the bank, raising the principal — so the EMI rises rather than costing you a lump sum.
                </p>
                {stepUps.map((r, i) => (
                  <LedgerRow key={i} label={monthLabel(r.date)} sub={`+ ${INR(r.disbursed)} disbursed`} value={`${INR(r.emi)}/mo`} tone={T.brassDeep} />
                ))}
              </div>
            )}

            {/* Prepayment section */}
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.rule}` }}>
              <button onClick={() => setPrepayOpenId(prepayOpen ? null : loan.id)} className="ldg-mono" style={{ background: "none", border: "none", color: T.brass, fontSize: 12, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
                <PiggyBank size={13} /> {prepayOpen ? "Hide" : "Make a"} prepayment {prepayList.length > 0 ? `(${prepayList.length} scheduled)` : ""}
              </button>

              {prepayOpen && (
                <div style={{ marginTop: 12, background: T.paperDim, border: `1px solid ${T.rule}`, borderRadius: 6, padding: 14 }}>
                  <p style={{ fontSize: 11.5, color: T.inkSoft, margin: "0 0 12px", lineHeight: 1.5 }}>
                    A prepayment goes straight against the principal that month. The EMI stays the same — the loan just ends sooner.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end", marginBottom: prepayList.length ? 14 : 0 }}>
                    <Field label="Amount (₹)"><input type="number" value={prepayForm.amount} onChange={(e) => setPrepayForm({ ...prepayForm, amount: e.target.value })} placeholder="e.g. 1000000" style={inputStyle} /></Field>
                    <Field label="Month &amp; Year"><input type="date" value={prepayForm.date} onChange={(e) => setPrepayForm({ ...prepayForm, date: e.target.value })} style={inputStyle} /></Field>
                    <button onClick={() => addPrepayment(loan.id)} style={addBtnStyle}><Plus size={16} /> Add</button>
                  </div>

                  {prepayList.map((pp) => (
                    <div key={pp.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${T.rule}` }}>
                      <div style={{ flex: 1, fontSize: 13 }}>{monthLabel(new Date(pp.date))}</div>
                      <span className="ldg-mono" style={{ fontSize: 13, fontWeight: 600, color: T.moss }}>{INR(pp.amount)}</span>
                      <button onClick={() => removePrepayment(loan.id, pp.id)} style={iconBtnStyle}><Trash2 size={14} /></button>
                    </div>
                  ))}

                  {prepayList.length > 0 && (
                    <div style={{ marginTop: 14, background: "rgba(76,195,138,0.10)", border: `1px solid ${T.moss}`, borderRadius: 6, padding: 14 }}>
                      <div className="ldg-mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: T.moss, marginBottom: 8 }}>What this saves you</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                        <MiniStat label="Interest Saved" value={INR_L(snap.interestSaved)} tone={T.moss} />
                        <MiniStat label="Months Saved" value={`${snap.monthsSaved} mo`} tone={T.moss} />
                        <MiniStat label="New Payoff Date" value={snap.payoffDate ? monthLabel(snap.payoffDate) : "—"} />
                        <MiniStat label="Was" value={snap.baselinePayoffDate ? monthLabel(snap.baselinePayoffDate) : "—"} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <button onClick={() => setOpenId(open ? null : loan.id)} className="ldg-mono" style={{ background: "none", border: "none", color: T.brass, fontSize: 12, cursor: "pointer", padding: "10px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
              {open ? "Hide" : "View"} full amortization schedule <ArrowRight size={12} />
            </button>

            {open && (
              <div style={{ marginTop: 10, maxHeight: 340, overflowY: "auto", border: `1px solid ${T.rule}`, borderRadius: 6 }}>
                <table className="ldg-mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ background: T.paperDim, position: "sticky", top: 0 }}>
                      {["#", "Month", "EMI", "Principal", "Interest", "Prepaid", "Balance"].map((h) => (
                        <th key={h} style={{ textAlign: h === "#" || h === "Month" ? "left" : "right", padding: "8px 10px", fontWeight: 600, color: T.inkSoft, borderBottom: `1px solid ${T.rule}`, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {snap.rows.map((r) => (
                      <tr key={r.n} style={{ background: r.prepaid > 0 ? "rgba(76,195,138,0.10)" : r.disbursed > 0 ? "rgba(212,175,55,0.10)" : "transparent" }}>
                        <td style={{ padding: "6px 10px", color: T.inkSoft }}>{r.n}</td>
                        <td style={{ padding: "6px 10px", whiteSpace: "nowrap" }}>{monthLabel(r.date)}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>{INR(r.emi)}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: T.moss }}>{INR(r.principal)}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: T.rust }}>{INR(r.interest)}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", color: T.moss }}>{r.prepaid > 0 ? INR(r.prepaid) : "—"}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right" }}>{INR(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}

      <Card>
        <h3 className="ldg-display" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>Take a New Loan</h3>
        <p style={{ fontSize: 12, color: T.inkSoft, margin: "0 0 14px" }}>Leave EMI blank to have it calculated from principal, rate and tenure.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, alignItems: "end" }}>
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Personal Loan — Bank Name" style={inputStyle} /></Field>
          <Field label="Type"><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={inputStyle}>{LOAN_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Amount (₹)"><input type="number" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} style={inputStyle} /></Field>
          <Field label="Rate (% p.a.)"><input type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} style={inputStyle} /></Field>
          <Field label="Tenure (months)"><input type="number" value={form.tenureMonths} onChange={(e) => setForm({ ...form, tenureMonths: e.target.value })} style={inputStyle} /></Field>
          <Field label="Actual EMI (₹)"><input type="number" value={form.emi} onChange={(e) => setForm({ ...form, emi: e.target.value })} placeholder="optional" style={inputStyle} /></Field>
          <Field label="First EMI Date"><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} style={inputStyle} /></Field>
          <button onClick={add} style={addBtnStyle}><Plus size={16} /> Add</button>
        </div>
        {previewEmi > 0 && !form.emi && (
          <div className="ldg-mono" style={{ marginTop: 12, fontSize: 12.5, color: T.brassDeep }}>
            Estimated EMI: <strong>{INR(previewEmi)}/mo</strong>
          </div>
        )}
        <button onClick={() => setLoans([])} className="ldg-mono" style={{ background: "none", border: `1px solid ${T.rule}`, borderRadius: 4, color: T.inkSoft, fontSize: 11.5, cursor: "pointer", padding: "6px 12px", marginTop: 14 }}>
          Clear all loans
        </button>
      </Card>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  return (
    <div>
      <div className="ldg-mono" style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: T.inkSoft, marginBottom: 3 }}>{label}</div>
      <div className="ldg-mono" style={{ fontSize: 14, fontWeight: 600, color: tone || T.ink }}>{value}</div>
    </div>
  );
}

/* ---------------- EXPENSES ---------------- */
function Expenses({ expenses, setExpenses, totalSpent, spentThisMonth, spendByCategory }) {
  const [form, setForm] = useState({ category: EXPENSE_CATEGORIES[0], amount: "", date: new Date().toISOString().slice(0, 10), notes: "", repeat: false, repeatMonths: 12 });

  const add = () => {
    if (!form.amount) return;
    if (form.repeat) {
      const seriesId = uid();
      const n = Math.max(1, Number(form.repeatMonths) || 12);
      const base = new Date(form.date);
      const entries = [];
      for (let i = 0; i < n; i++) {
        const d = new Date(base.getFullYear(), base.getMonth() + i, base.getDate());
        entries.push({ id: uid(), category: form.category, amount: Number(form.amount), date: d.toISOString().slice(0, 10), notes: form.notes, seriesId, seriesLabel: `${form.category}${form.notes ? " — " + form.notes : ""}`, seriesIndex: i + 1, seriesCount: n });
      }
      setExpenses((p) => [...entries, ...p]);
    } else {
      setExpenses((p) => [{ id: uid(), category: form.category, amount: Number(form.amount), date: form.date, notes: form.notes }, ...p]);
    }
    setForm({ category: form.category, amount: "", date: new Date().toISOString().slice(0, 10), notes: "", repeat: form.repeat, repeatMonths: form.repeatMonths });
  };

  const removeSeries = (seriesId) => setExpenses((p) => p.filter((x) => x.seriesId !== seriesId));

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
        <StatCard icon={Receipt} label="This Month" value={INR_L(spentThisMonth)} tone={T.rust} />
        <StatCard icon={TrendingDown} label="All-time Spent" value={INR_L(totalSpent)} />
        <StatCard icon={Landmark} label="Categories Used" value={spendByCategory.length} />
      </div>
      <Card style={{ marginBottom: 20 }}>
        <h3 className="ldg-display" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 14px" }}>Log a Spend</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1.4fr auto", gap: 10, alignItems: "end" }}>
          <Field label="Category"><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={inputStyle}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Amount (₹)"><input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} style={inputStyle} /></Field>
          <Field label={form.repeat ? "Starts" : "Date"}><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inputStyle} /></Field>
          <Field label="Notes"><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="optional" style={inputStyle} /></Field>
          <button onClick={add} style={addBtnStyle}><Plus size={16} /> Add</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
          <label className="ldg-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft, cursor: "pointer" }}>
            <input type="checkbox" checked={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.checked })} />
            repeats monthly — like rent
          </label>
          {form.repeat && (
            <label className="ldg-mono" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: T.inkSoft }}>
              for
              <input type="number" min="1" value={form.repeatMonths} onChange={(e) => setForm({ ...form, repeatMonths: e.target.value })} style={{ width: 56, border: `1px solid ${T.rule}`, borderRadius: 4, padding: "3px 5px", fontSize: 12, background: T.paper }} />
              months
            </label>
          )}
        </div>
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 20 }}>
        <Card>
          <h3 className="ldg-display" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 10px" }}>Entries</h3>
          {expenses.length === 0 ? <EmptyState text="No spends logged yet." /> : expenses.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${T.rule}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {e.category}{e.notes ? ` · ${e.notes}` : ""}
                  {e.seriesId && <span className="ldg-mono" style={{ fontSize: 10, color: T.brass, marginLeft: 6 }}>↻ {e.seriesIndex}/{e.seriesCount}</span>}
                </div>
                <div style={{ fontSize: 11.5, color: T.inkSoft }}>{e.date}</div>
              </div>
              <span className="ldg-mono" style={{ fontSize: 14, fontWeight: 600, color: T.rust }}>{INR(e.amount)}</span>
              {e.seriesId ? (
                <button onClick={() => removeSeries(e.seriesId)} className="ldg-mono" style={{ ...iconBtnStyle, fontSize: 10, color: T.rust }} title="Delete whole series"><Trash2 size={14} /></button>
              ) : (
                <button onClick={() => setExpenses((p) => p.filter((x) => x.id !== e.id))} style={iconBtnStyle}><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </Card>
        <Card>
          <h3 className="ldg-display" style={{ fontSize: 16, fontWeight: 600, margin: "0 0 10px" }}>By Category</h3>
          {spendByCategory.length === 0 ? <EmptyState text="Breakdown appears once you log spends." /> : (
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={spendByCategory} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.rule} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fontFamily: "IBM Plex Mono" }} tickFormatter={(v) => INR_L(v)} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11, fontFamily: "Inter" }} />
                  <Tooltip formatter={(v) => INR_L(v)} contentStyle={{ fontFamily: "IBM Plex Mono", fontSize: 12, borderRadius: 6, border: `1px solid ${T.rule}` }} />
                  <Bar dataKey="value" fill={T.rust} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
