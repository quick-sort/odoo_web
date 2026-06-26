/** @odoo-module */

import { Component, useEffect, useRef, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { useService } from "@web/core/utils/hooks";
import { _t } from "@web/core/l10n/translation";

const ACCOUNT_COLOR = "#1a73e8";
const BENCHMARK_COLOR = "#f39c12";

function fmtMoney(n) {
    if (n == null || isNaN(n)) return "-";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
    if (n == null || isNaN(n)) return "-";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
}

export class StockSimResultChart extends Component {
    setup() {
        this.orm = useService("orm");
        this.canvasRef = useRef("chart");
        this.chart = null;

        this.state = useState({
            loading: true,
            board: null,
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

        this._loadState();
    }

    async _loadState() {
        const result = await this.orm.call("stock.sim.game", "get_state", [[this.gameId]]);
        this.state.board = result && result[0];
        this.state.loading = false;
    }

    get board() {
        return this.state.board;
    }

    get accountCurve() {
        return (this.board && this.board.account_curve) || [];
    }
    get benchmarkCurve() {
        return (this.board && this.board.benchmark_curve) || [];
    }

    get summary() {
        const b = this.board;
        if (!b) return null;
        const acc = this.accountCurve;
        const bench = this.benchmarkCurve;
        const lastAccount = acc.length ? acc[acc.length - 1].total : b.total_assets;
        const lastBench = bench.length ? bench[bench.length - 1].value : b.starting_capital;
        const accountPct = b.total_pnl_pct;
        const benchPct = b.starting_capital
            ? (lastBench - b.starting_capital) / b.starting_capital * 100
            : 0;
        return {
            starting_capital: b.starting_capital,
            final_assets: lastAccount,
            account_pct: accountPct,
            bench_pct: benchPct,
            excess_pct: accountPct - benchPct,
            trade_count: b.trade_count,
            symbol_name: b.symbol_name,
            days: acc.length,
        };
    }

    renderChart() {
        this.destroyChart();
        const Chart = globalThis.Chart;
        if (!Chart) return;
        const acc = this.accountCurve;
        const bench = this.benchmarkCurve;
        if (!acc.length) return;

        const labels = acc.map((p) => String(p.date || "").slice(0, 10));
        const accountData = acc.map((p) => p.total);
        const benchData = bench.map((p) => p.value);

        if (this.canvasRef.el) {
            this.chart = new Chart(this.canvasRef.el, {
                type: "line",
                data: {
                    labels,
                    datasets: [
                        {
                            label: _t("账户市值"),
                            data: accountData,
                            borderColor: ACCOUNT_COLOR,
                            backgroundColor: "rgba(26,115,232,0.08)",
                            borderWidth: 2,
                            pointRadius: 0,
                            tension: 0.2,
                            fill: true,
                        },
                        {
                            label: _t("买入持有基准"),
                            data: benchData,
                            borderColor: BENCHMARK_COLOR,
                            backgroundColor: "rgba(243,156,18,0.05)",
                            borderWidth: 2,
                            borderDash: [5, 4],
                            pointRadius: 0,
                            tension: 0.2,
                            fill: false,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: { mode: "index", intersect: false },
                    plugins: {
                        legend: {
                            display: true,
                            position: "top",
                            labels: { boxWidth: 16, font: { size: 12 } },
                        },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const v = ctx.parsed.y;
                                    return `${ctx.dataset.label}: ${fmtMoney(v)}`;
                                },
                            },
                        },
                    },
                    scales: {
                        x: {
                            ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 24 },
                            grid: { display: false },
                        },
                        y: {
                            position: "right",
                            grid: { color: "rgba(0,0,0,0.06)" },
                            ticks: { maxTicksLimit: 6 },
                        },
                    },
                },
            });
        }
    }

    destroyChart() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }

    fmtMoney(n) { return fmtMoney(n); }
    fmtPct(n) { return fmtPct(n); }
    pctClass(n) {
        if (n > 0) return "o_pos";
        if (n < 0) return "o_neg";
        return "";
    }
}

StockSimResultChart.template = "stock_sim_trading.StockSimResultChart";
StockSimResultChart.props = { ...standardFieldProps };

registry.category("fields").add("stock_sim_result_chart", {
    component: StockSimResultChart,
    supportedTypes: ["json"],
    extractProps: () => ({}),
});
