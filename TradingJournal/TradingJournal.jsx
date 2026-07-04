import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

const FONT_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');";

const COLORS = {
  bg: "#0B0E14",
  panel: "#12161F",
  panelAlt: "#171C26",
  border: "#262E3A",
  borderSoft: "#1D2330",
  text: "#E9E6DD",
  textDim: "#8B93A1",
  textFaint: "#565F6E",
  amber: "#E3A23D",
  amberDim: "#8A6A38",
  gain: "#4FB877",
  gainDim: "#2E7A4E",
  loss: "#E0636A",
  lossDim: "#8F3D42",
  neutral: "#8B93A1",
  neutralDim: "#3A4150",
};

const STORAGE_KEY = "trades:list";
const OUTCOMES = ["Win", "Loss", "Breakeven"];
const BIASES = ["Long", "Short"];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return `${sign}$${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function fmtDate(d) {
  const dt = new Date(d + "T00:00:00");
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
    year: "2-digit",
  });
}

function outcomeColor(outcome) {
  if (outcome === "Win") return COLORS.gain;
  if (outcome === "Loss") return COLORS.loss;
  return COLORS.neutral;
}

function outcomeBorder(outcome) {
  if (outcome === "Win") return COLORS.gainDim;
  if (outcome === "Loss") return COLORS.lossDim;
  return COLORS.neutralDim;
}

const emptyForm = {
  time: new Date().toISOString().slice(0, 10),
  pair: "",
  bias: "Long",
  days: "",
  outcome: "Win",
  amount: "",
  setup: "",
};

export default function TradingJournal() {
  const [trades, setTrades] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [sortDesc, setSortDesc] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (mounted && res && res.value) {
          setTrades(JSON.parse(res.value));
        }
      } catch (e) {
        // no existing data yet
      } finally {
        if (mounted) setLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const persist = useCallback(async (next) => {
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(next), false);
    } catch (e) {
      setError("Couldn't save — your entry is only kept for this session.");
    }
  }, []);

  const addTrade = (e) => {
    e.preventDefault();
    setError("");
    const { time, pair, amount } = form;
    if (!time || !pair || amount === "") {
      setError("Fill in at least time, pair, and $ amount to log the trade.");
      return;
    }
    if (Number.isNaN(parseFloat(amount))) {
      setError("$ Amount needs to be a number.");
      return;
    }
    const trade = {
      id: uid(),
      ...form,
      pair: form.pair.trim().toUpperCase(),
    };
    const next = [...trades, trade];
    setTrades(next);
    persist(next);
    setForm(emptyForm);
    setFormOpen(false);
  };

  const deleteTrade = (id) => {
    const next = trades.filter((t) => t.id !== id);
    setTrades(next);
    persist(next);
  };

  const enriched = useMemo(
    () => trades.map((t) => ({ ...t, amountNum: parseFloat(t.amount) || 0 })),
    [trades]
  );

  const sorted = useMemo(() => {
    const arr = [...enriched].sort((a, b) =>
      a.time === b.time ? 0 : a.time < b.time ? -1 : 1
    );
    return sortDesc ? arr.reverse() : arr;
  }, [enriched, sortDesc]);

  const stats = useMemo(() => {
    if (enriched.length === 0) return null;
    const wins = enriched.filter((t) => t.outcome === "Win");
    const losses = enriched.filter((t) => t.outcome === "Loss");
    const breakeven = enriched.filter((t) => t.outcome === "Breakeven");
    const totalPnl = enriched.reduce((s, t) => s + t.amountNum, 0);
    const grossProfit = wins.reduce((s, t) => s + t.amountNum, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.amountNum, 0));
    const decisiveCount = wins.length + losses.length;
    const winRate = decisiveCount ? (wins.length / decisiveCount) * 100 : 0;
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const profitFactor =
      grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
    const best = enriched.reduce(
      (b, t) => (t.amountNum > (b ? b.amountNum : -Infinity) ? t : b),
      null
    );
    const worst = enriched.reduce(
      (w, t) => (t.amountNum < (w ? w.amountNum : Infinity) ? t : w),
      null
    );
    const daysVals = enriched.map((t) => parseFloat(t.days)).filter((v) => !Number.isNaN(v));
    const avgDays = daysVals.length ? daysVals.reduce((s, v) => s + v, 0) / daysVals.length : null;

    const groupBy = (key) => {
      const groups = {};
      enriched.forEach((t) => {
        const k = (t[key] || "—").trim() || "—";
        if (!groups[k]) groups[k] = { key: k, count: 0, wins: 0, losses: 0, pnl: 0 };
        groups[k].count += 1;
        groups[k].pnl += t.amountNum;
        if (t.outcome === "Win") groups[k].wins += 1;
        if (t.outcome === "Loss") groups[k].losses += 1;
      });
      return Object.values(groups)
        .map((g) => ({
          ...g,
          winRate: g.wins + g.losses ? (g.wins / (g.wins + g.losses)) * 100 : null,
        }))
        .sort((a, b) => b.pnl - a.pnl);
    };

    return {
      totalPnl,
      winCount: wins.length,
      lossCount: losses.length,
      breakevenCount: breakeven.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      best,
      worst,
      total: enriched.length,
      avgDays,
      byBias: groupBy("bias"),
      bySetup: groupBy("setup"),
    };
  }, [enriched]);

  const equityCurve = useMemo(() => {
    const chrono = [...enriched].sort((a, b) =>
      a.time === b.time ? 0 : a.time < b.time ? -1 : 1
    );
    let running = 0;
    return chrono.map((t, i) => {
      running += t.amountNum;
      return {
        idx: i + 1,
        time: t.time,
        equity: Math.round(running * 100) / 100,
        pair: t.pair,
      };
    });
  }, [enriched]);

  const isPositive = stats && stats.totalPnl >= 0;

  return (
    <div
      style={{
        fontFamily: "'Inter', sans-serif",
        background: COLORS.bg,
        color: COLORS.text,
        minHeight: "100vh",
        padding: "0",
      }}
    >
      <style>{`
        ${FONT_IMPORT}
        * { box-sizing: border-box; }
        .lj-num { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
        .lj-serif { font-family: 'Spectral', serif; }
        input, select, textarea { font-family: 'Inter', sans-serif; }
        .lj-input {
          background: ${COLORS.panelAlt};
          border: 1px solid ${COLORS.border};
          border-radius: 3px;
          color: ${COLORS.text};
          padding: 8px 10px;
          font-size: 13px;
          width: 100%;
          outline: none;
        }
        .lj-input:focus { border-color: ${COLORS.amberDim}; }
        .lj-label {
          font-size: 10.5px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: ${COLORS.textFaint};
          margin-bottom: 5px;
          display: block;
        }
        .lj-row-hover:hover { background: ${COLORS.panelAlt}; }
        .lj-scroll::-webkit-scrollbar { height: 6px; width: 6px; }
        .lj-scroll::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
        .lj-badge {
          font-size: 10.5px;
          padding: 2px 7px;
          border-radius: 3px;
          border: 1px solid;
          text-transform: uppercase;
          white-space: nowrap;
        }
      `}</style>

      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 24px 80px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderBottom: `1px solid ${COLORS.border}`,
            paddingBottom: 20,
            marginBottom: 32,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10.5,
                letterSpacing: "0.25em",
                color: COLORS.amber,
                marginBottom: 8,
                textTransform: "uppercase",
              }}
            >
              Vol. I — No. {String(trades.length).padStart(3, "0")}
            </div>
            <h1 className="lj-serif" style={{ margin: 0, fontSize: 34, fontWeight: 600 }}>
              The Ledger
            </h1>
            <div style={{ fontSize: 12.5, color: COLORS.textDim, marginTop: 4 }}>
              A running account of every position taken, and what it cost or paid.
            </div>
          </div>
          <button
            onClick={() => setFormOpen((v) => !v)}
            style={{
              background: formOpen ? COLORS.panelAlt : COLORS.amber,
              color: formOpen ? COLORS.text : "#1A1305",
              border: "none",
              borderRadius: 3,
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {formOpen ? "Cancel" : "+ Log a trade"}
          </button>
        </div>

        {/* Entry form */}
        {formOpen && (
          <form
            onSubmit={addTrade}
            style={{
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 4,
              padding: "22px 22px 18px",
              marginBottom: 32,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -1,
                left: 20,
                right: 20,
                height: 1,
                backgroundImage: `radial-gradient(circle, ${COLORS.bg} 2px, transparent 2px)`,
                backgroundSize: "10px 1px",
              }}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 14,
                marginBottom: 14,
              }}
            >
              <div>
                <label className="lj-label">Time</label>
                <input
                  type="date"
                  className="lj-input"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                />
              </div>
              <div>
                <label className="lj-label">Pair</label>
                <input
                  type="text"
                  className="lj-input"
                  placeholder="EURUSD"
                  value={form.pair}
                  onChange={(e) => setForm({ ...form, pair: e.target.value })}
                />
              </div>
              <div>
                <label className="lj-label">Bias</label>
                <select
                  className="lj-input"
                  value={form.bias}
                  onChange={(e) => setForm({ ...form, bias: e.target.value })}
                >
                  {BIASES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lj-label">Days</label>
                <input
                  type="number"
                  step="1"
                  className="lj-input"
                  placeholder="1"
                  value={form.days}
                  onChange={(e) => setForm({ ...form, days: e.target.value })}
                />
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 2fr auto",
                gap: 14,
                alignItems: "end",
              }}
            >
              <div>
                <label className="lj-label">Outcome</label>
                <select
                  className="lj-input"
                  value={form.outcome}
                  onChange={(e) => setForm({ ...form, outcome: e.target.value })}
                >
                  {OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="lj-label">$ Amount</label>
                <input
                  type="number"
                  step="any"
                  className="lj-input"
                  placeholder="e.g. 120 or -45"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div>
                <label className="lj-label">Setup</label>
                <input
                  type="text"
                  className="lj-input"
                  placeholder="Breakout, pullback, news..."
                  value={form.setup}
                  onChange={(e) => setForm({ ...form, setup: e.target.value })}
                />
              </div>
              <button
                type="submit"
                style={{
                  background: COLORS.amber,
                  color: "#1A1305",
                  border: "none",
                  borderRadius: 3,
                  padding: "9px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  height: 37,
                }}
              >
                Add entry
              </button>
            </div>
            {error && (
              <div style={{ color: COLORS.loss, fontSize: 12, marginTop: 12 }}>{error}</div>
            )}
          </form>
        )}

        {/* Stats */}
        {loaded && stats ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 1,
                background: COLORS.border,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 4,
                overflow: "hidden",
                marginBottom: 1,
              }}
            >
              <StatCell
                label="Net P&L"
                value={fmtMoney(stats.totalPnl)}
                color={isPositive ? COLORS.gain : COLORS.loss}
              />
              <StatCell
                label="Win rate"
                value={fmtPct(stats.winRate)}
                sub={`${stats.winCount}W / ${stats.lossCount}L / ${stats.breakevenCount}BE`}
              />
              <StatCell
                label="Profit factor"
                value={stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
              />
              <StatCell label="Trades logged" value={stats.total} />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 1,
                background: COLORS.border,
                border: `1px solid ${COLORS.border}`,
                borderTop: "none",
                borderRadius: "0 0 4px 4px",
                overflow: "hidden",
                marginBottom: 28,
              }}
            >
              <StatCell label="Avg win" value={fmtMoney(stats.avgWin)} color={COLORS.gain} />
              <StatCell label="Avg loss" value={fmtMoney(-stats.avgLoss)} color={COLORS.loss} />
              <StatCell
                label="Avg days held"
                value={stats.avgDays === null ? "—" : stats.avgDays.toFixed(1)}
              />
              <StatCell
                label="Best / worst"
                value={
                  <span>
                    <span style={{ color: COLORS.gain }}>{fmtMoney(stats.best.amountNum)}</span>
                    {" / "}
                    <span style={{ color: COLORS.loss }}>{fmtMoney(stats.worst.amountNum)}</span>
                  </span>
                }
              />
            </div>

            {/* Equity curve */}
            <div
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 4,
                padding: "18px 20px 8px",
                marginBottom: 28,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: COLORS.textFaint,
                  marginBottom: 10,
                }}
              >
                Cumulative equity
              </div>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <AreaChart data={equityCurve} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLORS.amber} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={COLORS.amber} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={COLORS.borderSoft} vertical={false} />
                    <XAxis
                      dataKey="idx"
                      tick={{ fill: COLORS.textFaint, fontSize: 11 }}
                      axisLine={{ stroke: COLORS.border }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: COLORS.textFaint, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${v}`}
                      width={60}
                    />
                    <ReferenceLine y={0} stroke={COLORS.border} />
                    <Tooltip
                      contentStyle={{
                        background: COLORS.panelAlt,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: COLORS.textDim }}
                      formatter={(v) => [fmtMoney(v), "Equity"]}
                      labelFormatter={(_, payload) =>
                        payload && payload[0]
                          ? `${fmtDate(payload[0].payload.time)} · ${payload[0].payload.pair}`
                          : ""
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke={COLORS.amber}
                      strokeWidth={2}
                      fill="url(#eqFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Breakdown by Bias and Setup */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginBottom: 28,
              }}
            >
              <BreakdownCard title="Performance by bias" rows={stats.byBias} />
              <BreakdownCard title="Performance by setup" rows={stats.bySetup} />
            </div>
          </>
        ) : loaded ? (
          <div
            style={{
              border: `1px dashed ${COLORS.border}`,
              borderRadius: 4,
              padding: "48px 20px",
              textAlign: "center",
              color: COLORS.textDim,
              marginBottom: 28,
            }}
          >
            <div className="lj-serif" style={{ fontSize: 18, color: COLORS.text, marginBottom: 6 }}>
              No entries yet
            </div>
            <div style={{ fontSize: 13 }}>
              Log your first trade above and the ledger will start keeping score.
            </div>
          </div>
        ) : (
          <div style={{ color: COLORS.textDim, fontSize: 13, marginBottom: 28 }}>
            Loading ledger…
          </div>
        )}

        {/* Trade log table */}
        {sorted.length > 0 && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: COLORS.textFaint,
                }}
              >
                Trade log
              </div>
              <button
                onClick={() => setSortDesc((v) => !v)}
                style={{
                  background: "transparent",
                  border: `1px solid ${COLORS.border}`,
                  color: COLORS.textDim,
                  fontSize: 11,
                  borderRadius: 3,
                  padding: "5px 10px",
                  cursor: "pointer",
                }}
              >
                Time {sortDesc ? "↓ newest" : "↑ oldest"}
              </button>
            </div>
            <div className="lj-scroll" style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    {["Time", "Pair", "Bias", "Days", "Outcome", "$ Amount", "Setup", ""].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: h === "$ Amount" || h === "Days" ? "right" : "left",
                          padding: "8px 10px",
                          fontSize: 10.5,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          color: COLORS.textFaint,
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((t) => (
                    <tr
                      key={t.id}
                      className="lj-row-hover"
                      style={{ borderBottom: `1px solid ${COLORS.borderSoft}` }}
                    >
                      <td className="lj-num" style={{ padding: "9px 10px", color: COLORS.textDim, whiteSpace: "nowrap" }}>
                        {fmtDate(t.time)}
                      </td>
                      <td style={{ padding: "9px 10px", fontWeight: 600 }}>{t.pair}</td>
                      <td style={{ padding: "9px 10px" }}>
                        <span
                          className="lj-badge"
                          style={{
                            borderColor: t.bias === "Long" ? COLORS.gainDim : COLORS.lossDim,
                            color: t.bias === "Long" ? COLORS.gain : COLORS.loss,
                          }}
                        >
                          {t.bias}
                        </span>
                      </td>
                      <td className="lj-num" style={{ padding: "9px 10px", textAlign: "right", color: COLORS.textDim }}>
                        {t.days || "—"}
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        <span
                          className="lj-badge"
                          style={{ borderColor: outcomeBorder(t.outcome), color: outcomeColor(t.outcome) }}
                        >
                          {t.outcome}
                        </span>
                      </td>
                      <td
                        className="lj-num"
                        style={{
                          padding: "9px 10px",
                          textAlign: "right",
                          fontWeight: 600,
                          color: t.amountNum >= 0 ? COLORS.gain : COLORS.loss,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {fmtMoney(t.amountNum)}
                      </td>
                      <td style={{ padding: "9px 10px", color: COLORS.textDim, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.setup || ""}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right" }}>
                        <button
                          onClick={() => deleteTrade(t.id)}
                          title="Delete entry"
                          style={{
                            background: "transparent",
                            border: "none",
                            color: COLORS.textFaint,
                            cursor: "pointer",
                            fontSize: 15,
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ marginTop: 40, fontSize: 11, color: COLORS.textFaint, textAlign: "center" }}>
          Entries are saved automatically and stay on this device.
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, sub, color }) {
  return (
    <div style={{ background: COLORS.panel, padding: "16px 16px 14px" }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: COLORS.textFaint,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div className="lj-num" style={{ fontSize: 19, fontWeight: 600, color: color || COLORS.text }}>
        {value}
      </div>
      {sub && (
        <div className="lj-num" style={{ fontSize: 11, color: COLORS.textFaint, marginTop: 3 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function BreakdownCard({ title, rows }) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 4,
        padding: "16px 18px",
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: COLORS.textFaint,
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {rows.length === 0 ? (
        <div style={{ color: COLORS.textFaint, fontSize: 12 }}>—</div>
      ) : (
        <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderBottom: `1px solid ${COLORS.borderSoft}` }}>
                <td style={{ padding: "6px 0", fontWeight: 600 }}>{r.key}</td>
                <td className="lj-num" style={{ padding: "6px 0", textAlign: "right", color: COLORS.textDim }}>
                  {r.count} trades
                </td>
                <td className="lj-num" style={{ padding: "6px 0", textAlign: "right", color: COLORS.textDim }}>
                  {r.winRate === null ? "—" : `${r.winRate.toFixed(0)}%`}
                </td>
                <td
                  className="lj-num"
                  style={{
                    padding: "6px 0 6px 12px",
                    textAlign: "right",
                    fontWeight: 600,
                    color: r.pnl >= 0 ? COLORS.gain : COLORS.loss,
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtMoney(r.pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
