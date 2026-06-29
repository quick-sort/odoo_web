/** @odoo-module */

import { Component, onWillUnmount, useEffect, useRef, useState } from "@odoo/owl";
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
    // Technical indicators overlaid on the price chart. Each entry adds a
    // toggle chip to the chart; the user can show/hide them at runtime.
    // MA: list of moving-average periods (empty list disables MA entirely).
    ma: [5, 10, 20, 60],
    ma_colors: ["#f5a623", "#4a90e2", "#bd10e0", "#e91e63"],
    // BOLL: { period, std_dev } or null/false to disable.
    boll: { period: 20, std_dev: 2 },
    boll_color: "#7e57c2",
    // Moving averages overlaid on the volume sub-chart (empty list disables).
    volume_ma: [5, 20],
    volume_ma_colors: ["#ff9800", "#5e35b1"],
};

// Colour palette cycled through when ``ma_colors`` does not cover a period.
const MA_PALETTE = ["#f5a623", "#4a90e2", "#bd10e0", "#e91e63", "#7ed321"];

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

function formatPrice(n) {
    if (n == null || isNaN(n)) return "";
    return Number(n).toFixed(2);
}

// Convert a #rgb / #rrggbb colour to an rgba() string with the given alpha.
function withAlpha(hex, alpha) {
    let h = String(hex || "#000000").replace("#", "").trim();
    if (h.length === 3) {
        h = h
            .split("")
            .map((c) => c + c)
            .join("");
    }
    if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
        return hex;
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Simple moving average as sparse {x, y} points (one per fully covered bar).
// x is the category index, matching the candlestick dataset's own x indices.
function smaPoints(values, period) {
    const points = [];
    if (!period || period < 1) {
        return points;
    }
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) {
            sum -= values[i - period];
        }
        if (i >= period - 1) {
            points.push({ x: i, y: sum / period });
        }
    }
    return points;
}

// Bollinger Bands: middle = SMA(period), upper/lower = middle ± k * stddev.
// Returns three sparse point arrays aligned to the same category indices.
function bollPoints(values, period, k) {
    const up = [];
    const mid = [];
    const low = [];
    if (!period || period < 2) {
        return { up, mid, low };
    }
    for (let i = period - 1; i < values.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
            sum += values[j];
        }
        const mean = sum / period;
        let variance = 0;
        for (let j = i - period + 1; j <= i; j++) {
            const d = values[j] - mean;
            variance += d * d;
        }
        const sd = Math.sqrt(variance / period);
        mid.push({ x: i, y: mean });
        up.push({ x: i, y: mean + k * sd });
        low.push({ x: i, y: mean - k * sd });
    }
    return { up, mid, low };
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

        // Per-indicator show/hide state. Keys are "ma:<period>" or "boll".
        // MA lines are on by default; BOLL is available but off by default so
        // the chart is not cluttered until the user opts in.
        this.ui = useState(this._initialIndicatorState());

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

    get hasIndicators() {
        const o = this.opts;
        return (Array.isArray(o.ma) && o.ma.length > 0) || !!o.boll;
    }

    // List of toggle chips rendered above the chart. Each chip carries its
    // toggle key, display label, line colour and current on/off state.
    get indicatorToggles() {
        const o = this.opts;
        const list = [];
        const periods = Array.isArray(o.ma) ? o.ma : [];
        periods.forEach((period, i) => {
            const color = (o.ma_colors && o.ma_colors[i]) || MA_PALETTE[i % MA_PALETTE.length];
            list.push({
                key: `ma:${period}`,
                label: `MA${period}`,
                color,
                dotStyle: `background:${color};`,
                on: !!this.ui[`ma:${period}`],
            });
        });
        if (o.boll) {
            list.push({
                key: "boll",
                label: `BOLL(${o.boll.period},${o.boll.std_dev})`,
                color: o.boll_color,
                dotStyle: `background:${o.boll_color};`,
                on: !!this.ui.boll,
            });
        }
        return list;
    }

    get hasVolumeIndicators() {
        return this.showVolume && Array.isArray(this.opts.volume_ma) && this.opts.volume_ma.length > 0;
    }

    // Toggle chips for the volume sub-chart (rendered on the volume panel).
    get volumeIndicatorToggles() {
        const o = this.opts;
        const list = [];
        const periods = Array.isArray(o.volume_ma) ? o.volume_ma : [];
        periods.forEach((period, i) => {
            const color =
                (o.volume_ma_colors && o.volume_ma_colors[i]) || MA_PALETTE[i % MA_PALETTE.length];
            list.push({
                key: `volma:${period}`,
                label: `VOLMA${period}`,
                color,
                dotStyle: `background:${color};`,
                on: !!this.ui[`volma:${period}`],
            });
        });
        return list;
    }

    _initialIndicatorState() {
        const o = this.opts;
        const state = {};
        const periods = Array.isArray(o.ma) ? o.ma : [];
        for (const period of periods) {
            state[`ma:${period}`] = true;
        }
        if (o.boll) {
            state.boll = false;
        }
        const volPeriods = Array.isArray(o.volume_ma) ? o.volume_ma : [];
        for (const period of volPeriods) {
            state[`volma:${period}`] = true;
        }
        return state;
    }

    toggleIndicator(key) {
        this.ui[key] = !this.ui[key];
        if (key.startsWith("volma:")) {
            this._applyVolumeIndicators();
        } else {
            this._applyIndicators();
        }
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

    // Build the overlaid line datasets for the currently enabled indicators.
    // Lines use parsing:false with {x: categoryIndex, y: value} so they share
    // the candlestick dataset's coordinate space and line up with each candle.
    _buildIndicatorDatasets(candles) {
        const o = this.opts;
        const datasets = [];
        const closes = candles.map((c) => c.c);

        const periods = Array.isArray(o.ma) ? o.ma : [];
        periods.forEach((period, i) => {
            if (!this.ui[`ma:${period}`]) {
                return;
            }
            const color = (o.ma_colors && o.ma_colors[i]) || MA_PALETTE[i % MA_PALETTE.length];
            datasets.push({
                type: "line",
                label: `MA${period}`,
                data: smaPoints(closes, period),
                parsing: false,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 1.2,
                pointRadius: 0,
                pointHoverRadius: 0,
                tension: 0,
            });
        });

        if (o.boll && this.ui.boll) {
            const { up, mid, low } = bollPoints(closes, o.boll.period, o.boll.std_dev);
            const color = o.boll_color;
            // Order matters: upper is pushed before low so upper.fill "+1"
            // targets the immediately following lower band, painting the band
            // regardless of how many MA datasets precede it.
            datasets.push({
                type: "line",
                label: _t("BOLL Up"),
                data: up,
                parsing: false,
                borderColor: color,
                backgroundColor: withAlpha(color, 0.08),
                borderWidth: 1,
                pointRadius: 0,
                pointHoverRadius: 0,
                tension: 0,
                fill: "+1",
            });
            datasets.push({
                type: "line",
                label: _t("BOLL Low"),
                data: low,
                parsing: false,
                borderColor: color,
                backgroundColor: withAlpha(color, 0.08),
                borderWidth: 1,
                pointRadius: 0,
                pointHoverRadius: 0,
                tension: 0,
            });
            datasets.push({
                type: "line",
                label: _t("BOLL Mid"),
                data: mid,
                parsing: false,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 1,
                pointRadius: 0,
                pointHoverRadius: 0,
                tension: 0,
                borderDash: [4, 4],
            });
        }

        return datasets;
    }

    // Re-apply indicator datasets without rebuilding the chart, so toggling a
    // line on/off keeps the current zoom/pan range. The candlestick dataset
    // (always index 0) is left untouched; only the trailing line datasets are
    // rebuilt.
    _applyIndicators() {
        if (!this.priceChart) {
            return;
        }
        const { candles } = this._buildSeries();
        const datasets = this.priceChart.data.datasets;
        datasets.length = 1;
        for (const ds of this._buildIndicatorDatasets(candles)) {
            datasets.push(ds);
        }
        this.priceChart.update("none");
    }

    // Line datasets for the volume sub-chart: moving averages of the volume
    // series. Same parsing:false + {x, y} scheme so they line up with the
    // volume bars (the bar dataset keeps its default label-based parsing).
    _buildVolumeIndicatorDatasets(volumes) {
        const o = this.opts;
        const datasets = [];
        const periods = Array.isArray(o.volume_ma) ? o.volume_ma : [];
        periods.forEach((period, i) => {
            if (!this.ui[`volma:${period}`]) {
                return;
            }
            const color =
                (o.volume_ma_colors && o.volume_ma_colors[i]) || MA_PALETTE[i % MA_PALETTE.length];
            datasets.push({
                type: "line",
                label: `VOLMA${period}`,
                data: smaPoints(volumes, period),
                parsing: false,
                borderColor: color,
                backgroundColor: color,
                borderWidth: 1.2,
                pointRadius: 0,
                pointHoverRadius: 0,
                tension: 0,
            });
        });
        return datasets;
    }

    // Re-apply volume MA datasets without rebuilding the volume chart, so the
    // toggle keeps the current zoom/pan. The bar dataset (index 0) is kept.
    _applyVolumeIndicators() {
        if (!this.volumeChart) {
            return;
        }
        const { volumes } = this._buildSeries();
        const datasets = this.volumeChart.data.datasets;
        datasets.length = 1;
        for (const ds of this._buildVolumeIndicatorDatasets(volumes)) {
            datasets.push(ds);
        }
        this.volumeChart.update("none");
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
                ? { align: "inner", maxRotation: 0, autoSkip: true, autoSkipPadding: 24 }
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
            const priceDatasets = [
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
                ...this._buildIndicatorDatasets(candles),
            ];
            this.priceChart = new ChartLib(this.priceCanvasRef.el, {
                type: "candlestick",
                data: {
                    labels: labels,
                    datasets: priceDatasets,
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
            const volumeDatasets = [
                {
                    label: _t("Volume"),
                    data: volumes,
                    backgroundColor: volumeColors,
                    borderWidth: 0,
                    maxBarThickness: 14,
                },
                ...this._buildVolumeIndicatorDatasets(volumes),
            ];
            this.volumeChart = new ChartLib(this.volumeCanvasRef.el, {
                type: "bar",
                data: {
                    labels: labels,
                    datasets: volumeDatasets,
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
                    if (!d) {
                        return "";
                    }
                    // Candlestick points carry o/h/l/c; line points carry {x, y}.
                    if (d.o != null && d.h != null && d.l != null && d.c != null) {
                        return [
                            `${_t("Open")}: ${d.o}`,
                            `${_t("High")}: ${d.h}`,
                            `${_t("Low")}: ${d.l}`,
                            `${_t("Close")}: ${d.c}`,
                        ];
                    }
                    if (d.y != null) {
                        return `${ctx.dataset.label}: ${formatPrice(d.y)}`;
                    }
                    return "";
                },
            },
        };
    }

    _volumeTooltip() {
        return {
            mode: "index",
            intersect: false,
            callbacks: {
                label: (ctx) => {
                    const d = ctx.raw;
                    if (d == null) {
                        return "";
                    }
                    // Bar points are bare numbers; VOLMA line points are {x, y}.
                    if (typeof d === "number") {
                        return `${_t("Volume")}: ${compactNumber(d)}`;
                    }
                    if (d.y != null) {
                        return `${ctx.dataset.label}: ${compactNumber(d.y)}`;
                    }
                    return "";
                },
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
