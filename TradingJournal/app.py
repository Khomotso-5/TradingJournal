"""
The Ledger — a trading performance journal.

Columns: Pair, Time, Bias, Days, Outcome, $ Amount, Setup.

Run with:
    streamlit run app.py

Data is stored locally in a SQLite file (trades.db) created next to this
script, so your trades persist between runs.
"""

import sqlite3
from contextlib import closing
from datetime import date

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

DB_PATH = "trades.db"

COLORS = {
    "bg": "#0B0E14",
    "panel": "#12161F",
    "amber": "#E3A23D",
    "gain": "#4FB877",
    "loss": "#E0636A",
    "neutral": "#8B93A1",
    "text": "#E9E6DD",
    "dim": "#8B93A1",
}

OUTCOMES = ["Win", "Loss", "Breakeven"]
BIASES = ["Long", "Short"]


# --------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------

def get_connection():
    return sqlite3.connect(DB_PATH)


def init_db():
    with closing(get_connection()) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pair TEXT NOT NULL,
                trade_time TEXT NOT NULL,
                bias TEXT NOT NULL CHECK (bias IN ('Long', 'Short')),
                days REAL,
                outcome TEXT NOT NULL CHECK (outcome IN ('Win', 'Loss', 'Breakeven')),
                amount REAL NOT NULL,
                setup TEXT DEFAULT ''
            )
            """
        )
        conn.commit()


def fetch_trades() -> pd.DataFrame:
    with closing(get_connection()) as conn:
        df = pd.read_sql_query("SELECT * FROM trades ORDER BY trade_time ASC, id ASC", conn)
    return df


def insert_trade(pair, trade_time, bias, days, outcome, amount, setup):
    with closing(get_connection()) as conn:
        conn.execute(
            """
            INSERT INTO trades (pair, trade_time, bias, days, outcome, amount, setup)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (pair.upper().strip(), trade_time, bias, days, outcome, amount, setup),
        )
        conn.commit()


def sync_edited_table(edited_df: pd.DataFrame, original_df: pd.DataFrame):
    """Reconcile the data_editor's output back into SQLite.

    Rows removed in the editor are deleted. Rows changed are updated.
    New rows (blank id) are inserted.
    """
    original_ids = set(original_df["id"].tolist()) if not original_df.empty else set()
    edited_ids = set(edited_df["id"].dropna().tolist()) if "id" in edited_df else set()

    with closing(get_connection()) as conn:
        for missing_id in original_ids - edited_ids:
            conn.execute("DELETE FROM trades WHERE id = ?", (int(missing_id),))

        for _, row in edited_df.iterrows():
            values = (
                str(row["pair"]).upper().strip(),
                str(row["trade_time"]),
                row["bias"],
                float(row["days"]) if pd.notna(row.get("days")) else None,
                row["outcome"],
                float(row["amount"]),
                str(row.get("setup") or ""),
            )
            if pd.isna(row.get("id")):
                conn.execute(
                    """
                    INSERT INTO trades (pair, trade_time, bias, days, outcome, amount, setup)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )
            else:
                conn.execute(
                    """
                    UPDATE trades
                    SET pair = ?, trade_time = ?, bias = ?, days = ?, outcome = ?, amount = ?, setup = ?
                    WHERE id = ?
                    """,
                    values + (int(row["id"]),),
                )
        conn.commit()


# --------------------------------------------------------------------------
# Calculations
# --------------------------------------------------------------------------

def compute_stats(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}
    wins = df[df["outcome"] == "Win"]
    losses = df[df["outcome"] == "Loss"]
    breakeven = df[df["outcome"] == "Breakeven"]

    gross_profit = wins["amount"].sum()
    gross_loss = abs(losses["amount"].sum())
    decisive = len(wins) + len(losses)
    win_rate = (len(wins) / decisive * 100) if decisive else 0
    avg_win = gross_profit / len(wins) if len(wins) else 0
    avg_loss = gross_loss / len(losses) if len(losses) else 0
    profit_factor = (gross_profit / gross_loss) if gross_loss else (float("inf") if gross_profit > 0 else 0)

    best = df.loc[df["amount"].idxmax()]
    worst = df.loc[df["amount"].idxmin()]
    avg_days = df["days"].dropna().mean() if df["days"].notna().any() else None

    def group_by(col):
        rows = []
        for key, g in df.groupby(col):
            g_wins = (g["outcome"] == "Win").sum()
            g_losses = (g["outcome"] == "Loss").sum()
            decisive_g = g_wins + g_losses
            rows.append(
                {
                    "key": key if key else "—",
                    "count": len(g),
                    "win_rate": (g_wins / decisive_g * 100) if decisive_g else None,
                    "pnl": g["amount"].sum(),
                }
            )
        return sorted(rows, key=lambda r: r["pnl"], reverse=True)

    return {
        "total_pnl": df["amount"].sum(),
        "win_count": len(wins),
        "loss_count": len(losses),
        "breakeven_count": len(breakeven),
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "best": best,
        "worst": worst,
        "total": len(df),
        "avg_days": avg_days,
        "by_bias": group_by("bias"),
        "by_setup": group_by("setup"),
    }


def fmt_money(n) -> str:
    sign = "-" if n < 0 else ""
    return f"{sign}${abs(n):,.2f}"


# --------------------------------------------------------------------------
# UI
# --------------------------------------------------------------------------

def inject_style():
    st.markdown(
        f"""
        <style>
        .stApp {{ background-color: {COLORS['bg']}; color: {COLORS['text']}; }}
        h1, h2, h3 {{ color: {COLORS['text']}; }}
        div[data-testid="stMetricValue"] {{ font-family: 'JetBrains Mono', monospace; }}
        .ledger-caption {{
            color: {COLORS['dim']};
            font-size: 0.85rem;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_header(trade_count: int):
    st.markdown(f"<div class='ledger-caption'>Vol. I — No. {trade_count:03d}</div>", unsafe_allow_html=True)
    st.title("The Ledger")
    st.caption("A running account of every position taken, and what it cost or paid.")


def render_entry_form():
    with st.expander("＋ Log a trade", expanded=False):
        with st.form("new_trade", clear_on_submit=True):
            c1, c2, c3, c4 = st.columns(4)
            trade_time = c1.date_input("Time", value=date.today())
            pair = c2.text_input("Pair", placeholder="EURUSD")
            bias = c3.selectbox("Bias", BIASES)
            days = c4.number_input("Days", min_value=0.0, step=1.0, format="%.0f")

            c5, c6, c7 = st.columns([1, 1, 2])
            outcome = c5.selectbox("Outcome", OUTCOMES)
            amount = c6.number_input("$ Amount", step=1.0, format="%.2f", help="Positive for profit, negative for loss")
            setup = c7.text_input("Setup", placeholder="Breakout, pullback, news...")

            submitted = st.form_submit_button("Add entry")
            if submitted:
                if not pair:
                    st.error("Fill in at least the pair to log the trade.")
                else:
                    insert_trade(pair, str(trade_time), bias, days, outcome, amount, setup)
                    st.success(f"Logged {pair.upper()} on {trade_time}.")
                    st.rerun()


def render_stats(stats: dict):
    row1 = st.columns(4)
    row1[0].metric("Net P&L", fmt_money(stats["total_pnl"]))
    row1[1].metric(
        "Win rate",
        f"{stats['win_rate']:.1f}%",
        f"{stats['win_count']}W / {stats['loss_count']}L / {stats['breakeven_count']}BE",
    )
    pf = stats["profit_factor"]
    row1[2].metric("Profit factor", "∞" if pf == float("inf") else f"{pf:.2f}")
    row1[3].metric("Trades logged", stats["total"])

    row2 = st.columns(4)
    row2[0].metric("Avg win", fmt_money(stats["avg_win"]))
    row2[1].metric("Avg loss", fmt_money(-stats["avg_loss"]))
    row2[2].metric("Avg days held", "—" if stats["avg_days"] is None else f"{stats['avg_days']:.1f}")
    row2[3].metric(
        "Best / worst",
        f"{fmt_money(stats['best']['amount'])} / {fmt_money(stats['worst']['amount'])}",
    )


def render_equity_curve(df: pd.DataFrame):
    curve = df.sort_values(["trade_time", "id"]).copy()
    curve["equity"] = curve["amount"].cumsum()
    curve["trade_no"] = range(1, len(curve) + 1)

    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=curve["trade_no"],
            y=curve["equity"],
            mode="lines",
            line=dict(color=COLORS["amber"], width=2),
            fill="tozeroy",
            fillcolor="rgba(227, 162, 61, 0.15)",
            hovertemplate="Trade %{x}<br>Equity: $%{y:,.2f}<extra></extra>",
        )
    )
    fig.add_hline(y=0, line_color="#262E3A")
    fig.update_layout(
        height=280,
        margin=dict(l=10, r=10, t=10, b=10),
        plot_bgcolor=COLORS["panel"],
        paper_bgcolor=COLORS["panel"],
        font=dict(color=COLORS["dim"]),
        xaxis=dict(title="Trade #", gridcolor="#1D2330"),
        yaxis=dict(title="Cumulative P&L ($)", gridcolor="#1D2330"),
    )
    st.plotly_chart(fig, use_container_width=True)


def render_breakdowns(stats: dict):
    c1, c2 = st.columns(2)
    with c1:
        st.markdown("**Performance by bias**")
        render_breakdown_table(stats["by_bias"])
    with c2:
        st.markdown("**Performance by setup**")
        render_breakdown_table(stats["by_setup"])


def render_breakdown_table(rows):
    if not rows:
        st.caption("—")
        return
    table = pd.DataFrame(rows)
    table["win_rate"] = table["win_rate"].apply(lambda v: "—" if v is None else f"{v:.0f}%")
    table["pnl"] = table["pnl"].apply(fmt_money)
    table = table.rename(columns={"key": "", "count": "Trades", "win_rate": "Win rate", "pnl": "P&L"})
    st.dataframe(table, hide_index=True, use_container_width=True)


def render_trade_table(df: pd.DataFrame):
    st.markdown(
        "<div class='ledger-caption'>Trade log — edit or delete rows directly</div>",
        unsafe_allow_html=True,
    )

    display_df = df[["id", "trade_time", "pair", "bias", "days", "outcome", "amount", "setup"]].copy()
    display_df = display_df.sort_values("trade_time", ascending=False).reset_index(drop=True)

    edited = st.data_editor(
        display_df,
        num_rows="dynamic",
        use_container_width=True,
        hide_index=True,
        column_config={
            "id": st.column_config.NumberColumn("ID", disabled=True),
            "trade_time": st.column_config.TextColumn("Time"),
            "pair": st.column_config.TextColumn("Pair"),
            "bias": st.column_config.SelectboxColumn("Bias", options=BIASES),
            "days": st.column_config.NumberColumn("Days", format="%.0f"),
            "outcome": st.column_config.SelectboxColumn("Outcome", options=OUTCOMES),
            "amount": st.column_config.NumberColumn("$ Amount", format="%.2f"),
            "setup": st.column_config.TextColumn("Setup"),
        },
        key="trade_editor",
    )

    if st.button("Save changes to log"):
        sync_edited_table(edited, display_df)
        st.success("Ledger updated.")
        st.rerun()

    csv = display_df.to_csv(index=False)
    st.download_button("Download trades as CSV", csv, file_name="trades.csv", mime="text/csv")


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    st.set_page_config(page_title="The Ledger — Trading Journal", layout="wide")
    inject_style()
    init_db()

    df = fetch_trades()
    render_header(len(df))
    render_entry_form()

    if df.empty:
        st.info("No entries yet. Log your first trade above and the ledger will start keeping score.")
        return

    stats = compute_stats(df)
    render_stats(stats)
    st.divider()
    render_equity_curve(df)
    st.divider()
    render_breakdowns(stats)
    st.divider()
    render_trade_table(df)

    st.caption("Entries are saved automatically to trades.db in this folder.")


if __name__ == "__main__":
    main()
