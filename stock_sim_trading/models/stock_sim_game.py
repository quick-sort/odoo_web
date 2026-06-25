import random

from odoo import _, api, fields, models
from odoo.exceptions import UserError

# 起始日之后至少保留这么多根 K 线，保证有足够的可交易日
MIN_FUTURE_BARS = 30


class StockSimGame(models.Model):
    """一局股票模拟交易。

    draft -> running -> finished 的状态机。``action_start`` 随机抽取一个标的
    及历史起始日；运行中只能按当日收盘价、以仓位比例买卖（做多、单标的）；
    ``action_finish`` 冻结账户/基准曲线供结果对比。
    """

    _name = "stock.sim.game"
    _description = "Stock Simulation Game"
    _order = "id desc"

    # ── 基础 ─────────────────────────────────────────────────────
    name = fields.Char(string="名称", required=True, default="模拟交易")
    state = fields.Selection(
        selection=[
            ("draft", "草稿"),
            ("running", "进行中"),
            ("finished", "已结束"),
        ],
        string="状态",
        default="draft",
        required=True,
        tracking=True,
    )
    user_id = fields.Many2one(
        comodel_name="res.users",
        string="负责人",
        default=lambda self: self.env.user,
    )
    active = fields.Boolean(default=True)

    # ── 配置（draft 期可编辑）─────────────────────────────────────
    starting_capital = fields.Float(string="起始资金", digits=(16, 2), default=100000.0)
    commission_rate = fields.Float(
        string="佣金费率",
        digits=(8, 6),
        default=0.00025,
        help="如 0.00025 = 万分之 2.5，买卖双向",
    )
    min_commission = fields.Float(string="最低佣金", digits=(16, 2), default=5.0)
    stamp_duty_rate = fields.Float(
        string="印花税率",
        digits=(8, 6),
        default=0.0005,
        help="如 0.0005 = 千分之一，卖出单向",
    )
    transfer_fee_rate = fields.Float(
        string="过户费率",
        digits=(8, 6),
        default=0.00001,
        help="如 0.00001 = 十万分之 1，买卖双向",
    )
    trade_lot = fields.Integer(string="最小手(股)", default=100, help="买入按此单位取整")
    symbol_ids = fields.Many2many(
        comodel_name="kline.example.symbol",
        relation="stock_sim_game_symbol_rel",
        column1="game_id",
        column2="symbol_id",
        string="标的范围",
    )

    # ── 运行态 ────────────────────────────────────────────────────
    symbol_id = fields.Many2one(comodel_name="kline.example.symbol", string="随机标的")
    start_index = fields.Integer(string="起始序号")
    current_index = fields.Integer(string="当前序号")
    cash = fields.Float(string="现金", digits=(16, 2), default=0.0)
    shares = fields.Float(string="持股", digits=(16, 2), default=0.0)
    avg_cost = fields.Float(string="持仓均价", digits=(16, 4), default=0.0)

    trade_ids = fields.One2many(
        comodel_name="stock.sim.trade",
        inverse_name="game_id",
        string="交易记录",
    )

    # ── 计算字段 ──────────────────────────────────────────────────
    start_date = fields.Date(string="起始日", compute="_compute_dates", store=False)
    current_date = fields.Date(string="当前日", compute="_compute_dates", store=False)
    days_count = fields.Integer(string="已过交易日", compute="_compute_dates", store=False)
    close_price = fields.Float(string="当日收盘", compute="_compute_close", store=False)
    is_last_day = fields.Boolean(string="已是末日", compute="_compute_close", store=False)
    position_value = fields.Float(string="持仓市值", compute="_compute_position", store=False)
    total_assets = fields.Float(string="总资产", compute="_compute_position", store=False)
    total_pnl = fields.Float(string="盈亏额", compute="_compute_position", store=False)
    total_pnl_pct = fields.Float(string="盈亏率(%)", compute="_compute_position", store=False)
    trade_count = fields.Integer(string="交易笔数", compute="_compute_trades", store=False)

    # ── 数据缓存 ──────────────────────────────────────────────────
    account_curve = fields.Json(string="账户曲线")
    benchmark_curve = fields.Json(string="基准曲线")

    # ════════════════════════════════════════════════════════════════
    #  Compute
    # ════════════════════════════════════════════════════════════════
    def _get_klines(self):
        """归一化取标的 K 线序列为 list。"""
        self.ensure_one()
        if not self.symbol_id:
            return []
        data = self.symbol_id.kline_data
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("data") or []
        return []

    def _bar_value(self, index, key, default=0.0):
        klines = self._get_klines()
        if not klines or not (0 <= index < len(klines)):
            return default
        return klines[index].get(key, default)

    @api.depends("symbol_id", "start_index", "current_index")
    def _compute_dates(self):
        for rec in self:
            klines = rec._get_klines()
            start_idx = rec.start_index if 0 <= rec.start_index < len(klines) else 0
            cur_idx = rec.current_index if 0 <= rec.current_index < len(klines) else start_idx
            rec.start_date = self._parse_date(klines[start_idx].get("date")) if klines else False
            rec.current_date = self._parse_date(klines[cur_idx].get("date")) if klines else False
            rec.days_count = max(0, cur_idx - start_idx)

    @staticmethod
    def _parse_date(value):
        if not value:
            return False
        if isinstance(value, fields.Date):
            return value
        try:
            return fields.Date.from_string(str(value)[:10])
        except Exception:
            return False

    @api.depends("symbol_id", "current_index")
    def _compute_close(self):
        for rec in self:
            rec.close_price = rec._bar_value(rec.current_index, "close")
            klines = rec._get_klines()
            rec.is_last_day = bool(klines) and rec.current_index >= len(klines) - 1

    @api.depends("cash", "shares", "symbol_id", "current_index")
    def _compute_position(self):
        for rec in self:
            position = rec.shares * rec.close_price
            total = rec.cash + position
            rec.position_value = round(position, 2)
            rec.total_assets = round(total, 2)
            pnl = total - rec.starting_capital
            rec.total_pnl = round(pnl, 2)
            rec.total_pnl_pct = round(pnl / rec.starting_capital * 100, 2) if rec.starting_capital else 0.0

    @api.depends("trade_ids")
    def _compute_trades(self):
        for rec in self:
            rec.trade_count = len(rec.trade_ids)

    # ════════════════════════════════════════════════════════════════
    #  费用
    # ════════════════════════════════════════════════════════════════
    def _calc_fees(self, side, gross):
        """返回 (commission, stamp_duty, transfer_fee, total_fee)。"""
        self.ensure_one()
        commission = max(gross * self.commission_rate, self.min_commission)
        stamp_duty = gross * self.stamp_duty_rate if side == "sell" else 0.0
        transfer_fee = gross * self.transfer_fee_rate
        return {
            "commission": round(commission, 2),
            "stamp_duty": round(stamp_duty, 2),
            "transfer_fee": round(transfer_fee, 2),
            "total_fee": round(commission + stamp_duty + transfer_fee, 2),
        }

    # ════════════════════════════════════════════════════════════════
    #  状态机：动作
    # ════════════════════════════════════════════════════════════════
    def action_start(self):
        for rec in self:
            if rec.state != "draft":
                raise UserError(_("只有草稿状态可以开始。"))
            if not rec.symbol_ids:
                raise UserError(_("请先选择标的范围。"))
            if rec.starting_capital <= 0:
                raise UserError(_("起始资金必须大于 0。"))
            if rec.trade_lot <= 0:
                raise UserError(_("最小手数必须大于 0。"))

            # 随机抽一个有足够 K 线的标的
            candidates = rec.symbol_ids.filtered(lambda s: len(self._get_klines_from(s)) >= MIN_FUTURE_BARS + 1)
            pool = candidates or rec.symbol_ids
            symbol = random.choice(pool)
            klines = rec._get_klines_from(symbol)
            if not klines:
                raise UserError(_("标的 %s 无 K 线数据。") % symbol.display_name)

            # 随机起始日，留足未来交易日
            last_allowed = max(0, len(klines) - MIN_FUTURE_BARS)
            start_index = random.randint(0, last_allowed) if last_allowed > 0 else 0

            rec.write({
                "state": "running",
                "symbol_id": symbol.id,
                "start_index": start_index,
                "current_index": start_index,
                "cash": rec.starting_capital,
                "shares": 0.0,
                "avg_cost": 0.0,
            })
            rec._refresh_curves()
        return True

    def action_next_day(self):
        for rec in self:
            if rec.state != "running":
                raise UserError(_("模拟未在进行中。"))
            klines = rec._get_klines()
            if rec.current_index >= len(klines) - 1:
                raise UserError(_("已是最后一日，请结束模拟。"))
            rec.current_index += 1
            rec._refresh_curves()
        return True

    def action_buy(self, ratio):
        """ratio: 0~100，使用可用现金的比例。"""
        for rec in self:
            if rec.state != "running":
                raise UserError(_("模拟未在进行中。"))
            if not (0 < ratio <= 100):
                raise UserError(_("买入比例需在 0~100 之间。"))
            price = rec.close_price
            if not price:
                raise UserError(_("当日无收盘价。"))
            budget = rec.cash * ratio / 100.0
            lot = rec.trade_lot

            # 不含费粗估，再向下对齐到手数并校验费用
            max_shares = int(budget / price)
            shares = (max_shares // lot) * lot
            total_cost = 0.0
            fees = {"commission": 0.0, "stamp_duty": 0.0, "transfer_fee": 0.0, "total_fee": 0.0}
            while shares > 0:
                gross = shares * price
                fees = rec._calc_fees("buy", gross)
                total_cost = gross + fees["total_fee"]
                if total_cost <= rec.cash + 1e-6:
                    break
                shares -= lot
            if shares <= 0:
                raise UserError(_("现金不足，按当前比例无法买入最小手数 %s 股。") % lot)

            gross = shares * price
            old_value = rec.shares * rec.avg_cost
            new_shares = rec.shares + shares
            new_avg_cost = (old_value + gross) / new_shares if new_shares else 0.0
            rec.write({
                "cash": rec.cash - total_cost,
                "shares": new_shares,
                "avg_cost": new_avg_cost,
            })
            rec._record_trade("buy", price, ratio, shares, gross, fees, total_cost)
            rec._refresh_curves()
        return True

    def action_sell(self, ratio):
        """ratio: 0~100，卖出当前持股的比例（不能超过持仓）。"""
        for rec in self:
            if rec.state != "running":
                raise UserError(_("模拟未在进行中。"))
            if not (0 < ratio <= 100):
                raise UserError(_("卖出比例需在 0~100 之间。"))
            if rec.shares <= 0:
                raise UserError(_("当前无持仓。"))
            price = rec.close_price
            if not price:
                raise UserError(_("当日无收盘价。"))

            shares = int(rec.shares * ratio / 100.0)
            shares = min(shares, int(rec.shares))
            if shares <= 0:
                raise UserError(_("按当前比例卖出的股数不足 1 股。"))

            gross = shares * price
            fees = rec._calc_fees("sell", gross)
            net_received = gross - fees["total_fee"]
            new_shares = rec.shares - shares
            rec.write({
                "cash": rec.cash + net_received,
                "shares": new_shares,
                "avg_cost": rec.avg_cost if new_shares > 0 else 0.0,
            })
            rec._record_trade("sell", price, ratio, shares, gross, fees, net_received)
            rec._refresh_curves()
        return True

    def action_finish(self):
        for rec in self:
            if rec.state != "running":
                raise UserError(_("模拟未在进行中。"))
            rec._refresh_curves()
            rec.state = "finished"
        return True

    def action_reset(self):
        """回到草稿，清空运行态（保留配置），可重新开始。"""
        for rec in self:
            rec.write({
                "state": "draft",
                "symbol_id": False,
                "start_index": 0,
                "current_index": 0,
                "cash": 0.0,
                "shares": 0.0,
                "avg_cost": 0.0,
                "account_curve": None,
                "benchmark_curve": None,
            })
            rec.trade_ids.unlink()
        return True

    # ════════════════════════════════════════════════════════════════
    #  内部：记录交易 / 刷新曲线
    # ════════════════════════════════════════════════════════════════
    def _record_trade(self, side, price, ratio, shares, gross, fees, net_amount):
        self.ensure_one()
        next_seq = (self.trade_ids and max(self.trade_ids.mapped("sequence")) or 0) + 1
        # net_amount 语义：买入=花费(含费)，卖出=到账(扣费)
        return self.env["stock.sim.trade"].create({
            "game_id": self.id,
            "sequence": next_seq,
            "date": self.current_date,
            "bar_index": self.current_index,
            "side": side,
            "price": price,
            "ratio": ratio,
            "shares": shares,
            "gross_amount": round(gross, 2),
            "commission": fees["commission"],
            "stamp_duty": fees["stamp_duty"],
            "transfer_fee": fees["transfer_fee"],
            "total_fee": fees["total_fee"],
            "net_amount": round(net_amount, 2),
            "cash_after": round(self.cash, 2),
            "shares_after": round(self.shares, 2),
            "avg_cost_after": round(self.avg_cost, 4),
            "position_value_after": round(self.position_value, 2),
            "total_assets_after": round(self.total_assets, 2),
        })

    def _refresh_curves(self):
        """回放交易重建账户/基准曲线并落库。"""
        for rec in self:
            account, benchmark = rec._build_curves()
            rec.account_curve = account
            rec.benchmark_curve = benchmark

    def _build_curves(self):
        """从 start_index 回放到 current_index，逐日输出账户与基准曲线。"""
        self.ensure_one()
        klines = self._get_klines()
        if not klines:
            return [], []
        trades_by_bar = {}
        for trade in self.trade_ids:
            trades_by_bar.setdefault(trade.bar_index, []).append(trade)

        cash = self.starting_capital
        shares = 0.0
        start_close = klines[self.start_index].get("close") or 1.0
        account_curve = []
        benchmark_curve = []
        for i in range(self.start_index, self.current_index + 1):
            bar = klines[i]
            close = bar.get("close") or 0.0
            # 应用当日的全部交易（按序号）
            for trade in sorted(trades_by_bar.get(i, []), key=lambda t: t.sequence):
                if trade.side == "buy":
                    cash -= trade.net_amount
                    shares += trade.shares
                else:  # sell
                    cash += trade.net_amount
                    shares -= trade.shares
            position = shares * close
            account_curve.append({
                "date": bar.get("date"),
                "close": close,
                "cash": round(cash, 2),
                "position": round(position, 2),
                "total": round(cash + position, 2),
            })
            benchmark_curve.append({
                "date": bar.get("date"),
                "value": round(self.starting_capital * close / start_close, 2) if start_close else 0.0,
            })
        return account_curve, benchmark_curve

    @api.model
    def _get_klines_from(self, symbol):
        data = symbol.kline_data
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("data") or []
        return []

    # ════════════════════════════════════════════════════════════════
    #  面板数据（供 OWL 组件读取）
    # ════════════════════════════════════════════════════════════════
    def _to_board_dict(self):
        """返回给前端的面板数据（不含 K 线原始数据，前端按需另行拉取）。"""
        self.ensure_one()
        return {
            "id": self.id,
            "state": self.state,
            "name": self.name,
            # config
            "starting_capital": self.starting_capital,
            "commission_rate": self.commission_rate,
            "min_commission": self.min_commission,
            "stamp_duty_rate": self.stamp_duty_rate,
            "transfer_fee_rate": self.transfer_fee_rate,
            "trade_lot": self.trade_lot,
            # runtime
            "symbol_id": self.symbol_id.id if self.symbol_id else False,
            "symbol_name": self.symbol_id.name or "",
            "symbol_code": self.symbol_id.code or "",
            "start_index": self.start_index,
            "current_index": self.current_index,
            "cash": round(self.cash, 2),
            "shares": round(self.shares, 2),
            "avg_cost": round(self.avg_cost, 4),
            # computed
            "close_price": round(self.close_price, 4),
            "start_date": self.start_date and fields.Date.to_string(self.start_date) or "",
            "current_date": self.current_date and fields.Date.to_string(self.current_date) or "",
            "days_count": self.days_count,
            "is_last_day": self.is_last_day,
            "position_value": round(self.position_value, 2),
            "total_assets": round(self.total_assets, 2),
            "total_pnl": round(self.total_pnl, 2),
            "total_pnl_pct": round(self.total_pnl_pct, 4),
            "trade_count": self.trade_count,
            "account_curve": self.account_curve or [],
            "benchmark_curve": self.benchmark_curve or [],
            "trades": self._trades_for_board(),
        }

    def _trades_for_board(self):
        self.ensure_one()
        result = []
        for t in self.trade_ids.sorted(lambda x: x.sequence):
            result.append({
                "sequence": t.sequence,
                "date": t.date and fields.Date.to_string(t.date) or "",
                "side": t.side,
                "price": round(t.price, 4),
                "ratio": round(t.ratio, 2),
                "shares": round(t.shares, 2),
                "gross_amount": round(t.gross_amount, 2),
                "total_fee": round(t.total_fee, 2),
                "total_assets_after": round(t.total_assets_after, 2),
            })
        return result

    @api.model
    def get_state(self, game_ids):
        """供 OWL 组件调用的统一读取入口，返回面板数据列表。"""
        games = self.browse(game_ids)
        return [g._to_board_dict() for g in games]

    @api.model
    def get_klines(self, symbol_ids):
        """供 OWL 组件按 symbol id 批量取 K 线。"""
        out = {}
        for symbol in self.env["kline.example.symbol"].browse(symbol_ids):
            out[symbol.id] = self._get_klines_from(symbol)
        return out
