import random
from datetime import date, timedelta

from odoo import api, fields, models


class KlineExampleSymbol(models.Model):
    """示例标的：在 json 字段 ``kline_data`` 中存放 OHLCV 行情序列，
    供 ``kline_chart`` 控件渲染 K 线主图 + 成交额副图。
    """

    _name = "kline.example.symbol"
    _description = "Kline Example: Symbol"
    _order = "code, name"

    name = fields.Char(string="名称", required=True)
    code = fields.Char(string="代码", required=True)
    market = fields.Selection(
        selection=[
            ("sh", "沪市"),
            ("sz", "深市"),
            ("index", "指数"),
            ("us", "美股"),
            ("hk", "港股"),
        ],
        string="市场",
        default="sh",
    )
    kline_data = fields.Json(string="K 线数据", help="OHLCV 数组：date / open / high / low / close / volume")
    notes = fields.Text(string="备注")

    bar_count = fields.Integer(compute="_compute_bar_count", string="K 线根数")

    @api.depends("kline_data")
    def _compute_bar_count(self):
        for rec in self:
            data = rec.kline_data
            if isinstance(data, list):
                rec.bar_count = len(data)
            elif isinstance(data, dict):
                rec.bar_count = len(data.get("data") or [])
            else:
                rec.bar_count = 0

    @api.model
    def _populate_demo_kline(self, rec_id, n_days, start_price, drift, vol, seed, volume_base):
        """Generate a deterministic OHLCV series of ``n_days`` weekday bars and
        store it on the given record. Used by the demo data so the large series
        does not have to be embedded as a JSON literal in XML.
        """
        rnd = random.Random(seed)
        days = []
        current = date(2020, 1, 2)
        while len(days) < n_days:
            if current.weekday() < 5:
                days.append(current)
            current += timedelta(days=1)
        price = start_price
        series = []
        for day in days:
            open_ = round(price, 2)
            change = rnd.gauss(drift, vol)
            close = round(max(0.01, open_ * (1 + change)), 2)
            high = round(max(open_, close) * (1 + abs(rnd.gauss(0, vol * 0.5))), 2)
            low = round(min(open_, close) * (1 - abs(rnd.gauss(0, vol * 0.5))), 2)
            volume = int(volume_base * (1 + rnd.uniform(-0.4, 0.6)))
            series.append({
                "date": day.isoformat(),
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
            })
            price = close
        self.browse(rec_id).kline_data = series
