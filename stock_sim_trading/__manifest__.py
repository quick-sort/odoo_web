{
    "name": "Stock Simulation Trading",
    "version": "19.0.1.0.0",
    "category": "Web",
    "summary": "Blind K-line trading simulator: start with capital, trade day by day at close, compare with buy-and-hold",
    "description": """
        Stock simulation trading addon.

        Create a simulation game, pick a universe of instruments, then the
        system randomly picks one symbol and a random historical start date.
        You advance day by day, only seeing the K-line up to the current day,
        and can only buy/sell at the day's close price using a position ratio.

        Features:
        - Configurable starting capital and trading fees/taxes
          (commission + min commission, stamp duty on sell, transfer fee).
        - Long-only, single instrument per game.
        - Buy by a ratio of available cash, sell by a ratio of holdings
          (cannot exceed holdings).
        - Live position market value after each operation.
        - Full trade log.
        - Account value curve vs. buy-and-hold benchmark on finish.
    """,
    "depends": [
        "web",
        "web_widget_kline_chart",
    ],
    "data": [
        "security/ir.model.access.csv",
        "views/stock_sim_game_views.xml",
        "views/stock_sim_trade_views.xml",
    ],
    "demo": [
        "demo/stock_sim_demo.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "stock_sim_trading/static/src/fields/stock_sim_board.js",
            "stock_sim_trading/static/src/fields/stock_sim_board.xml",
            "stock_sim_trading/static/src/fields/stock_sim_board.scss",
            "stock_sim_trading/static/src/fields/stock_sim_result_chart.js",
            "stock_sim_trading/static/src/fields/stock_sim_result_chart.xml",
            "stock_sim_trading/static/src/fields/stock_sim_result_chart.scss",
        ],
    },
    "author": "Apexive Solutions LLC",
    "website": "https://github.com/apexive/odoo-llm",
    "installable": True,
    "application": True,
    "auto_install": False,
    "license": "LGPL-3",
}
