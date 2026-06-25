{
    "name": "Web Widget Kline Chart",
    "version": "19.0.1.0.0",
    "category": "Web",
    "summary": "Stock K-line (candlestick) chart with volume sub-chart for JSON fields",
    "description": """
        Adds a field widget that renders stock market K-line (candlestick)
        charts from OHLCV data stored in a JSON field.

        Features:
        - Candlestick main chart (open/high/low/close) powered by Chart.js
          and the chartjs-chart-financial plugin.
        - Volume (成交额) sub-chart aligned below the price chart.
        - Scroll-wheel zoom and drag pan on the time axis (chartjs-plugin-zoom),
          synced between the two charts.
        - Up/down colours, field key mapping and chart height are
          configurable through the field ``options``.
    """,
    "depends": [
        "web",
    ],
    "data": [
        "security/ir.model.access.csv",
        "views/kline_example_views.xml",
    ],
    "demo": [
        "demo/kline_example_demo.xml",
    ],
    "assets": {
        "web.assets_backend": [
            # Vendored libraries (UMD, load Chart.js before the plugins)
            "web_widget_kline_chart/static/lib/chartjs/chart.umd.js",
            "web_widget_kline_chart/static/lib/chartjs/chartjs-chart-financial.min.js",
            # hammer.js must load before the zoom plugin: the plugin uses it for
            # drag pan / pinch (it reads globalThis.Hammer when it initialises).
            "web_widget_kline_chart/static/lib/chartjs/hammer.min.js",
            "web_widget_kline_chart/static/lib/chartjs/chartjs-plugin-zoom.min.js",
            # Field widget
            "web_widget_kline_chart/static/src/fields/kline_chart_field.js",
            "web_widget_kline_chart/static/src/fields/kline_chart_field.xml",
            "web_widget_kline_chart/static/src/fields/kline_chart_field.scss",
        ],
    },
    "author": "Apexive Solutions LLC",
    "website": "https://github.com/apexive/odoo-llm",
    "installable": True,
    "application": True,
    "auto_install": False,
    "license": "LGPL-3",
}
