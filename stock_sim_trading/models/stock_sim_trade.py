from odoo import fields, models


class StockSimTrade(models.Model):
    """单笔模拟交易流水。

    由 ``stock.sim.game`` 的 ``action_buy`` / ``action_sell`` 自动生成，
    每条记录保存成交价、输入比例、成交股数、各项费用，以及成交后的账户快照
    （现金、持股、均价、持仓市值、总市值）。
    """

    _name = "stock.sim.trade"
    _description = "Stock Simulation Trade"
    _order = "game_id, sequence"

    game_id = fields.Many2one(
        comodel_name="stock.sim.game",
        string="模拟局",
        required=True,
        ondelete="cascade",
        index=True,
    )
    sequence = fields.Integer(string="序号", default=1)

    # ── 时间 / 定位 ──────────────────────────────────────────────
    date = fields.Date(string="交易日", required=True)
    bar_index = fields.Integer(string="K 线序号")

    # ── 成交 ────────────────────────────────────────────────────
    side = fields.Selection(
        selection=[
            ("buy", "买入"),
            ("sell", "卖出"),
        ],
        string="方向",
        required=True,
    )
    price = fields.Float(string="成交价", digits=(16, 4))
    ratio = fields.Float(string="输入比例(%)", digits=(5, 2))
    shares = fields.Float(string="成交股数", digits=(16, 2))
    gross_amount = fields.Float(string="成交金额", digits=(16, 2))

    # ── 费用 ────────────────────────────────────────────────────
    commission = fields.Float(string="佣金", digits=(16, 2))
    stamp_duty = fields.Float(string="印花税", digits=(16, 2))
    transfer_fee = fields.Float(string="过户费", digits=(16, 2))
    total_fee = fields.Float(string="总费用", digits=(16, 2))
    net_amount = fields.Float(
        string="净额",
        digits=(16, 2),
        help="买入为实际花费（含费），卖出为实际到账（扣费）",
    )

    # ── 成交后账户快照 ───────────────────────────────────────────
    cash_after = fields.Float(string="成交后现金", digits=(16, 2))
    shares_after = fields.Float(string="成交后持股", digits=(16, 2))
    avg_cost_after = fields.Float(string="成交后均价", digits=(16, 4))
    position_value_after = fields.Float(string="成交后持仓市值", digits=(16, 2))
    total_assets_after = fields.Float(string="成交后总市值", digits=(16, 2))
