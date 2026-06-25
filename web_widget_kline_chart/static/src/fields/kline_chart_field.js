/** @odoo-module */

import { Component, onWillUnmount, useEffect, useRef } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { _t } from "@web/core/l10n/translation";

const DEFAULTS = {
    data_key: "data",
    date_key: "date",
    open_key: "open",
    high_key: "high",
    low_key: "low",
    close_key: "close",
    volume_key: "volume",
    up_color: "#26a69a",
    down_color: "#ef5350",
    volume_up_color: "rgba(38, 166, 154, 0.6)",
    volume_down_color: "rgba(239, 83, 80, 0.6)",
    height: 440,
    show_volume: true,
};

// Fixed width reserved for the right-hand value axis so the plot areas of the
// price chart and the volume chart line up vertically (same x positions).
const Y_AXIS_WIDTH = 56;

// Per-chart plugin: draws a dashed vertical line through the active (hovered)
// element. Registered per chart (not globally) so it only affects these charts.
const CROSSHAIR_PLUGIN = {
    id: "klineCrosshair",
    afterDraw(chart) {
        const active = chart.getActiveElements && chart.getActiveElements();
        if (!active || !active.length) {
            return;
        }
        const x = active[0].element.x;
        const area = chart.chartArea;
        if (x == null || x < area.left - 2 || x > area.right + 2) {
            return;
        }
        const ctx = chart.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, area.top);
        ctx.lineTo(x, area.bottom);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(60, 60, 60, 0.45)";
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.restore();
    },
};

function compactNumber(n) {
    if (n == null || isNaN(n)) return "";
    const abs = Math.abs(n);
    if (abs >= 1e8) return (n / 1e8).toFixed(2) + "亿";
    if (abs >= 1e4) return (n / 1e4).toFixed(2) + "万";
    return new Intl.NumberFormat().format(n);
}

function formatDate(value) {
    if (value == null || value === "") return "";
    if (value instanceof Date) {
        return _fmtDate(value);
    }
    if (typeof value === "number") {
        const d = new Date(value);
        if (!isNaN(d.getTime())) return _fmtDate(d);
        return String(value);
    }
    const asString = String(value);
    const d = new Date(asString);
    if (!isNaN(d.getTime())) return _fmtDate(d);
    return asString;
}

function _fmtDate(d) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
}

export class KlineChartField extends Component {
    setup() {
        this.rootRef = useRef("root");
        this.priceCanvasRef = useRef("priceCanvas");
        this.volumeCanvasRef = useRef("volumeCanvas");
        this.priceChart = null;
        this.volumeChart = null;
        // Re-entrancy guard: syncing one chart's zoom to the other fires the
        // other's zoom callback, which would otherwise sync back endlessly.
        this._syncing = false;
        // Index currently mirrored to the other chart, so hover sync only
        // redraws when the hovered candle actually changes.
        this._lastSyncIndex = null;

        useEffect(
            () => {
                this.renderChart();
                return () => this.destroyChart();
            },
            () => [this.props.record.data[this.props.name]]
        );

        onWillUnmount(() => this.destroyChart());
    }

    get opts() {
        return Object.assign({}, DEFAULTS, this.props.options || {});
    }

    get showVolume() {
        return !!this.opts.show_volume;
    }

    get isEmpty() {
        return this._rawData().length === 0;
    }

    get containerStyle() {
        return `height:${this.opts.height}px;`;
    }

    _rawData() {
        let value = this.props.record.data[this.props.name];
        if (value == null || value === "") return [];
        if (typeof value === "string") {
            try {
                value = JSON.parse(value);
            } catch (e) {
                return [];
            }
        }
        if (Array.isArray(value)) return value;
        if (value && typeof value === "object") {
            const arr = value[this.opts.data_key];
            if (Array.isArray(arr)) return arr;
        }
        return [];
    }

    _buildSeries() {
        const o = this.opts;
        const rows = this._rawData();
        const labels = [];
        const candles = [];
        const volumes = [];
        const volumeColors = [];
        for (const item of rows) {
            const open = item[o.open_key];
            const high = item[o.high_key];
            const low = item[o.low_key];
            const close = item[o.close_key];
            if (
                open == null ||
                high == null ||
                low == null ||
                close == null ||
                [open, high, low, close].some((v) => isNaN(Number(v)))
            ) {
                continue;
            }
            labels.push(formatDate(item[o.date_key]));
            candles.push({
                // The financial controller runs with parsing:false, so it reads
                // data points raw. Its y-range computation filters points by an
                // `x` value, so each candle must carry its own category index or
                // no candles are drawn.
                x: candles.length,
                o: Number(open),
                h: Number(high),
                l: Number(low),
                c: Number(close),
            });
            const rawVolume = item[o.volume_key];
            const volume = rawVolume == null || isNaN(Number(rawVolume)) ? 0 : Number(rawVolume);
            volumes.push(volume);
            volumeColors.push(close >= open ? o.volume_up_color : o.volume_down_color);
        }
        return { labels, candles, volumes, volumeColors };
    }

    renderChart() {
        this.destroyChart();
        this._lastSyncIndex = null;
        const ChartLib = globalThis.Chart;
        if (!ChartLib) {
            return;
        }
        const { labels, candles, volumes, volumeColors } = this._buildSeries();
        const o = this.opts;

        // Both charts share a category x-axis (same labels and bar spacing) and a
        // right-hand y-axis pinned to a fixed width, so candles and volume bars
        // line up on the same vertical positions.
        const makeX = (showTicks) => ({
            type: "category",
            labels: labels,
            ticks: showTicks
                ? { maxRotation: 0, autoSkip: true, autoSkipPadding: 24 }
                : { display: false },
            grid: { display: false },
            afterFit: (scale) => {
                scale.width = 0;
            },
        });
        const makeY = (ticks) => ({
            position: "right",
            grid: { color: "rgba(0,0,0,0.06)" },
            ticks: ticks,
            afterFit: (scale) => {
                scale.width = Y_AXIS_WIDTH;
            },
        });

        if (this.priceCanvasRef.el) {
            this.priceChart = new ChartLib(this.priceCanvasRef.el, {
                type: "candlestick",
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: _t("Price"),
                            data: candles,
                            parsing: false,
                            backgroundColors: {
                                up: o.up_color,
                                down: o.down_color,
                                unchanged: o.up_color,
                            },
                            borderColors: {
                                up: o.up_color,
                                down: o.down_color,
                                unchanged: o.up_color,
                            },
                            borderWidth: 1,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    layout: { padding: 0 },
                    interaction: { mode: "index", intersect: false },
                    onHover: (event, activeElements, chart) =>
                        this._onChartHover(activeElements, chart),
                    plugins: {
                        legend: { display: false },
                        tooltip: this._priceTooltip(),
                        zoom: this._zoomPluginOptions(),
                    },
                    scales: {
                        x: makeX(false),
                        y: makeY({ maxTicksLimit: 6 }),
                    },
                },
                plugins: [CROSSHAIR_PLUGIN],
            });
        }

        if (this.showVolume && this.volumeCanvasRef.el) {
            this.volumeChart = new ChartLib(this.volumeCanvasRef.el, {
                type: "bar",
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: _t("Volume"),
                            data: volumes,
                            backgroundColor: volumeColors,
                            borderWidth: 0,
                            maxBarThickness: 14,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    layout: { padding: 0 },
                    interaction: { mode: "index", intersect: false },
                    onHover: (event, activeElements, chart) =>
                        this._onChartHover(activeElements, chart),
                    plugins: {
                        legend: { display: false },
                        tooltip: this._volumeTooltip(),
                        zoom: this._zoomPluginOptions(),
                    },
                    scales: {
                        x: makeX(true),
                        y: makeY({
                            maxTicksLimit: 3,
                            callback: (value) => compactNumber(value),
                        }),
                    },
                },
                plugins: [CROSSHAIR_PLUGIN],
            });
        }
    }

    _priceTooltip() {
        return {
            mode: "index",
            intersect: false,
            callbacks: {
                label: (ctx) => {
                    const d = ctx.raw;
                    if (!d) return "";
                    return [
                        `${_t("Open")}: ${d.o}`,
                        `${_t("High")}: ${d.h}`,
                        `${_t("Low")}: ${d.l}`,
                        `${_t("Close")}: ${d.c}`,
                    ];
                },
            },
        };
    }

    _volumeTooltip() {
        return {
            mode: "index",
            intersect: false,
            callbacks: {
                label: (ctx) => `${_t("Volume")}: ${compactNumber(ctx.raw)}`,
            },
        };
    }

    destroyChart() {
        if (this.priceChart) {
            this.priceChart.destroy();
            this.priceChart = null;
        }
        if (this.volumeChart) {
            this.volumeChart.destroy();
            this.volumeChart = null;
        }
    }

    _zoomPluginOptions() {
        // Wheel zoom + drag pan + pinch on the x axis only. Drag pan / pinch
        // go through hammer.js, which must be loaded before the zoom plugin.
        // The price y-axis re-fits to the visible candles automatically, since
        // the financial controller's range computation respects the zoomed x
        // bounds.
        return {
            pan: {
                enabled: true,
                mode: "x",
                onPanComplete: (ctx) => this._syncZoom(ctx.chart),
            },
            zoom: {
                wheel: { enabled: true, speed: 0.1 },
                pinch: { enabled: true },
                drag: { enabled: false },
                mode: "x",
                onZoom: (ctx) => this._syncZoom(ctx.chart),
            },
        };
    }

    _syncZoom(source) {
        if (this._syncing || !source) {
            return;
        }
        const target = source === this.priceChart ? this.volumeChart : this.priceChart;
        if (!target) {
            return;
        }
        const x = source.scales && source.scales.x;
        if (!x) {
            return;
        }
        this._syncing = true;
        try {
            target.zoomScale("x", { min: x.min, max: x.max });
        } finally {
            this._syncing = false;
        }
    }

    onResetZoomClick() {
        this._syncing = true;
        try {
            if (this.priceChart) {
                this.priceChart.resetZoom();
            }
            if (this.volumeChart) {
                this.volumeChart.resetZoom();
            }
        } finally {
            this._syncing = false;
        }
    }

    _onChartHover(activeElements, source) {
        if (this._syncing) {
            return;
        }
        const target = source === this.priceChart ? this.volumeChart : this.priceChart;
        if (!target) {
            return;
        }
        const index = activeElements.length ? activeElements[0].index : null;
        if (index === this._lastSyncIndex) {
            return;
        }
        this._lastSyncIndex = index;
        this._syncing = true;
        try {
            if (index == null) {
                this._clearHover(target);
            } else {
                this._showHover(target, index);
            }
        } finally {
            this._syncing = false;
        }
    }

    _showHover(chart, index) {
        const el = chart.getDatasetMeta(0).data[index];
        if (!el) {
            return;
        }
        chart.setActiveElements([{ datasetIndex: 0, index }]);
        chart.tooltip.setActiveElements([{ datasetIndex: 0, index }], { x: el.x, y: el.y });
        chart.update("none");
    }

    _clearHover(chart) {
        chart.setActiveElements([]);
        chart.tooltip.setActiveElements([], { x: 0, y: 0 });
        chart.update("none");
    }

    onMouseLeave() {
        this._lastSyncIndex = null;
        this._syncing = true;
        try {
            if (this.priceChart) {
                this._clearHover(this.priceChart);
            }
            if (this.volumeChart) {
                this._clearHover(this.volumeChart);
            }
        } finally {
            this._syncing = false;
        }
    }
}

KlineChartField.template = "web_widget_kline_chart.KlineChartField";
KlineChartField.props = {
    ...standardFieldProps,
    options: { type: Object, optional: true },
};
KlineChartField.defaultProps = {
    options: {},
};

export const klineChartField = {
    component: KlineChartField,
    supportedTypes: ["json"],
    extractProps({ options }) {
        return { options };
    },
};

registry.category("fields").add("kline_chart", klineChartField);
