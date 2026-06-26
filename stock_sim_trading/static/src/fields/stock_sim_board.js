/** @odoo-module */

import { Component, useEffect, useRef, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

const UP_COLOR = "#26a69a";
const DOWN_COLOR = "#ef5350";
const VOL_UP = "rgba(38,166,154,0.6)";
const VOL_DOWN = "rgba(239,83,80,0.6)";
const Y_AXIS_WIDTH = 56;

function compactMoney(n) {
    if (n == null || isNaN(n)) return "-";
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1e8) return sign + (abs / 1e8).toFixed(2) + " 亿";
    if (abs >= 1e4) return sign + (abs / 1e4).toFixed(2) + " 万";
    return sign + abs.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMoney(n) {
    if (n == null || isNaN(n)) return "-";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(pct) {
    if (pct == null || isNaN(pct)) return "-";
    return (pct > 0 ? "+" : "") + pct.toFixed(2) + "%";
}

export class StockSimBoard extends Component {
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.priceCanvasRef = useRef("priceCanvas");
        this.volumeCanvasRef = useRef("volumeCanvas");
        this.priceChart = null;
        this.volumeChart = null;
        this.klines = [];
        this.klineSymbolId = null;

        this.state = useState({
            loading: true,
            busy: false,
            board: null,
            ratio: 50,
        });

        this.gameId = this.props.record.resId;

        useEffect(
            () => {
                if (!this.state.loading && this.state.board) {
                    this.renderChart();
                }
                return () => this.destroyChart();
            },
            () => [this.state.loading, this.state.board]
        );

        // fetch initial state; component renders a loading placeholder meanwhile
        this._loadState();
    }

    get board() {
        return this.state.board;
    }

    get pnlClass() {
        if (!this.board) return "";
        if (this.board.total_pnl > 0) return "o_pos";
        if (this.board.total_pnl < 0) return "o_neg";
        return "";
    }

    /** 预估：当前比例下实际可买入的股数（与 action_buy 同口径：按手取整、扣买入费用）*/
    get buyEstimate() {
        const zero = { shares: 0, lots: 0 };
        const b = this.board;
        if (!b) return zero;
        const cash = b.cash;
        const price = b.close_price;
        const lot = b.trade_lot || 100;
        const ratio = this.state.ratio;
        if (!price || price <= 0 || lot <= 0) return zero;
        const budget = cash * ratio / 100;
        // 与 action_buy 一致：先用预算/单价封顶，再向下取整到手数，最后扣买入费用
        let shares = Math.floor(Math.floor(budget / price) / lot) * lot;
        while (shares > 0) {
            const gross = shares * price;
            if (gross + this._buyFee(gross) <= cash + 1e-6) break;
            shares -= lot;
        }
        return { shares, lots: Math.floor(shares / lot) };
    }

    /** 预估：当前比例下可卖股数（与 action_sell 同口径）*/
    get sellSharesEstimate() {
        if (!this.board) return 0;
        return Math.floor(this.board.shares * this.state.ratio / 100);
    }

    _buyFee(gross) {
        const b = this.board;
        if (!b) return 0;
        const commission = Math.max(gross * (b.commission_rate || 0), b.min_commission || 0);
        return commission + gross * (b.transfer_fee_rate || 0);
    }

    async _loadState() {
        const result = await this.orm.call("stock.sim.game", "get_state", [[this.gameId]]);
        const board = result && result[0];
        this.state.board = board;
        const symId = board && board.symbol_id;
        if (symId && symId !== this.klineSymbolId) {
            const kl = await this.orm.call("stock.sim.game", "get_klines", [[symId]]);
            this.klines = (kl && kl[symId]) || [];
            this.klineSymbolId = symId;
        }
        this.state.loading = false;
    }

    async callAction(method, ...args) {
        if (this.state.busy) return false;
        this.state.busy = true;
        let ok = false;
        try {
            await this.orm.call("stock.sim.game", method, [[this.gameId], ...args]);
            await this._loadState();
            ok = true;
        } catch (err) {
            this.notification.add(
                (err && (err.data && err.data.message || err.message)) || _t("操作失败"),
                { type: "danger" }
            );
        } finally {
            this.state.busy = false;
        }
        return ok;
    }

    setRatio(v) {
        this.state.ratio = v;
    }

    onBuy() {
        return this.callAction("action_buy", this.state.ratio);
    }
    onSell() {
        return this.callAction("action_sell", this.state.ratio);
    }
    onNext() {
        return this.callAction("action_next_day");
    }
    async onFinish() {
        const ok = await this.callAction("action_finish");
        // 结束后切换到结果视图：重载表单
        if (ok) {
            await this.props.record.model.load({ resId: this.gameId });
        }
    }

    // ── 图表 ────────────────────────────────────────────────────
    _visibleBars() {
        if (!this.klines.length || !this.board) return [];
        const end = this.board.current_index + 1;
        return this.klines.slice(0, Math.max(0, end));
    }

    _series() {
        const bars = this._visibleBars();
        const labels = [];
        const candles = [];
        const volumes = [];
        const volColors = [];
        for (const b of bars) {
            const o = Number(b.open), h = Number(b.high), l = Number(b.low), c = Number(b.close);
            if ([o, h, l, c].some((v) => isNaN(v))) continue;
            labels.push(this._fmtDate(b.date));
            candles.push({ x: candles.length, o, h, l, c });
            const v = Number(b.volume) || 0;
            volumes.push(v);
            volColors.push(c >= o ? VOL_UP : VOL_DOWN);
        }
        return { labels, candles, volumes, volColors };
    }

    _fmtDate(value) {
        if (!value) return "";
        return String(value).slice(0, 10);
    }

    renderChart() {
        this.destroyChart();
        const Chart = globalThis.Chart;
        if (!Chart) return;
        const { labels, candles, volumes, volColors } = this._series();

        const makeX = (showTicks) => ({
            type: "category",
            labels,
            ticks: showTicks
                ? { maxRotation: 0, autoSkip: true, autoSkipPadding: 24 }
                : { display: false },
            grid: { display: false },
            afterFit: (s) => { s.width = 0; },
        });
        const makeY = (ticks) => ({
            position: "right",
            grid: { color: "rgba(0,0,0,0.06)" },
            ticks,
            afterFit: (s) => { s.width = Y_AXIS_WIDTH; },
        });

        if (this.priceCanvasRef.el) {
            this.priceChart = new Chart(this.priceCanvasRef.el, {
                type: "candlestick",
                data: {
                    labels,
                    datasets: [{
                        label: _t("价格"),
                        data: candles,
                        parsing: false,
                        backgroundColors: { up: UP_COLOR, down: DOWN_COLOR, unchanged: UP_COLOR },
                        borderColors: { up: UP_COLOR, down: DOWN_COLOR, unchanged: UP_COLOR },
                        borderWidth: 1,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    plugins: { legend: { display: false } },
                    scales: { x: makeX(false), y: makeY({ maxTicksLimit: 6 }) },
                },
            });
        }
        if (this.volumeCanvasRef.el) {
            this.volumeChart = new Chart(this.volumeCanvasRef.el, {
                type: "bar",
                data: {
                    labels,
                    datasets: [{
                        label: _t("成交额"),
                        data: volumes,
                        backgroundColor: volColors,
                        borderWidth: 0,
                        maxBarThickness: 12,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: makeX(true),
                        y: makeY({ maxTicksLimit: 3, callback: (v) => compactMoney(v) }),
                    },
                },
            });
        }
    }

    destroyChart() {
        if (this.priceChart) { this.priceChart.destroy(); this.priceChart = null; }
        if (this.volumeChart) { this.volumeChart.destroy(); this.volumeChart = null; }
    }

    // ── 格式化（模板内调用）────────────────────────────────────
    fmtMoney(n) {
        return formatMoney(n);
    }
    fmtPct(n) {
        return formatPercent(n);
    }
    sideLabel(side) {
        return side === "buy" ? _t("买入") : _t("卖出");
    }
}

StockSimBoard.template = "stock_sim_trading.StockSimBoard";
StockSimBoard.props = { ...standardFieldProps };

registry.category("fields").add("stock_sim_board", {
    component: StockSimBoard,
    supportedTypes: ["json"],
    extractProps: () => ({}),
});
