# Web Widget Kline Chart

A field widget for Odoo 19 that renders a **stock K-line (candlestick) chart**
with a **volume (成交额) sub-chart** from OHLCV data stored in a `json` field.

Built with [Chart.js](https://www.chartjs.org/) v4 and the
[chartjs-chart-financial](https://github.com/chartjs/chartjs-chart-financial)
plugin, both vendored under `static/lib/`.

## Installation

Install like any Odoo addon (drop the folder in your addons path, update the
apps list, install **Web Widget Kline Chart**). The libraries and the field
component are added to `web.assets_backend`.

## Usage

Declare a `json` field on your model and use `widget="kline_chart"` in the form
view:

```xml
<field name="kline_data" widget="kline_chart" />
```

The chart fills its container, so give it full width. Inside a form `<group>`
(default 2 columns) add `colspan="2"` and `nolabel="1"`:

```xml
<field name="kline_data" widget="kline_chart" nolabel="1" colspan="2"/>
```

Configure the rendering with the standard field `options` attribute:

```xml
<field
    name="kline_data"
    widget="kline_chart"
    options="{
        'height': 480,
        'up_color': '#26a69a',
        'down_color': '#ef5350',
        'show_volume': True,
    }"
/>
```

## Data format

The `json` field holds the OHLCV series. Two shapes are accepted:

### 1. A plain array of candles (recommended)

```json
[
    { "date": "2024-01-02", "open": 100.0, "high": 103.5, "low": 99.2,  "close": 102.1, "volume": 1200000 },
    { "date": "2024-01-03", "open": 102.1, "high": 104.0, "low": 101.0, "close": 101.4, "volume": 980000 },
    { "date": "2024-01-04", "open": 101.4, "high": 102.8, "low": 100.1, "close": 102.6, "volume": 1450000 }
]
```

### 2. An object wrapping the array under a key

```json
{
    "data": [ /* candles as above */ ]
}
```

The wrapping key defaults to `data` and can be changed with the `data_key`
option.

Each candle maps its fields through the configurable keys below. `open`, `high`,
`low` and `close` are required; `volume` is optional (rows without it are still
drawn on the price chart).

## Options

| Option              | Default                                   | Description                                                                 |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `data_key`          | `"data"`                                  | Key that holds the array when the JSON value is an object.                  |
| `date_key`          | `"date"`                                  | Field used for the x-axis label (parsed as a date when possible).           |
| `open_key`          | `"open"`                                  | Open price field.                                                           |
| `high_key`          | `"high"`                                  | High price field.                                                           |
| `low_key`           | `"low"`                                   | Low price field.                                                            |
| `close_key`         | `"close"`                                 | Close price field.                                                          |
| `volume_key`        | `"volume"`                                | Volume field for the sub-chart.                                             |
| `up_color`          | `"#26a69a"`                               | Candle colour when `close >= open`.                                         |
| `down_color`        | `"#ef5350"`                               | Candle colour when `close < open`.                                          |
| `volume_up_color`   | `"rgba(38, 166, 154, 0.6)"`               | Volume bar colour on up days.                                               |
| `volume_down_color` | `"rgba(239, 83, 80, 0.6)"`                | Volume bar colour on down days.                                             |
| `height`            | `440`                                     | Total chart height in pixels.                                               |
| `show_volume`       | `True`                                    | Render the volume sub-chart.                                                |

## How it works

The widget renders **two stacked Chart.js charts** that share the same category
x-axis (the trading dates) and a right-hand value axis pinned to a fixed width,
so each candle lines up exactly with its volume bar below it.

The widget name registered in the field registry is `kline_chart`.

## Zoom & pan

The chart supports horizontal zoom/pan via the `chartjs-plugin-zoom` plugin:

- **Scroll wheel** — zoom in/out on the time axis.
- **Drag** — pan left/right along the time axis.
- **Pinch** (touch) — zoom on the time axis.
- **↺ button** (top-left) — reset the zoom.

The two charts are kept in sync: zooming or panning one updates the other's
time range, and the price axis re-fits to the visible candles automatically.
Drag pan and pinch rely on the bundled `hammer.js` (loaded before the zoom
plugin, which consumes `globalThis.Hammer` when it initialises).

## Crosshair & linked tooltips

Hovering either chart draws a dashed vertical **crosshair** that spans that
chart, and mirrors the hover onto the other chart — so the price tooltip
(open/high/low/close) and the volume tooltip move together at the same date.
Moving the pointer away hides both. (The crosshair is drawn by a small
per-chart plugin and the two stay aligned because both charts share a
category x-axis and a fixed-width y-axis.)

## Demo data

The addon ships a sample model `kline.example.symbol` (fields: `name`, `code`,
`market`, `kline_data` json, `bar_count`) with three demo records — 贵州茅台,
宁德时代 and 上证指数 — each carrying a 30-day OHLCV series. After installing
with demo data, open the **K 线图（演示） → 标的行情** menu to see the widget in
action. The form view binds the field with:

```xml
<field name="kline_data" widget="kline_chart"
       options="{'height': 460, 'show_volume': True}"/>
```
