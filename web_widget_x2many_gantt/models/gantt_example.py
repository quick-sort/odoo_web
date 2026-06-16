from odoo import api, fields, models

PHASE_TYPES = [
    ("preclinical", "临床前研究"),
    ("ind",         "IND 申报"),
    ("phase1",      "I 期"),
    ("phase2",      "II 期"),
    ("phase3",      "III 期"),
    ("nda",         "NDA/BLA 申报"),
    ("review",      "技术审评"),
    ("approved",    "上市批准"),
    ("phase4",      "IV 期（上市后）"),
]

THERAPEUTIC_AREAS = [
    ("oncology",    "肿瘤"),
    ("cardiology",  "心血管"),
    ("neurology",   "神经系统"),
    ("immunology",  "免疫"),
    ("infectious",  "感染"),
    ("respiratory", "呼吸"),
    ("rare",        "罕见病"),
    ("other",       "其他"),
]

STATUS_TYPES = [
    ("planned",    "计划中"),
    ("ongoing",    "进行中"),
    ("completed",  "已完成"),
    ("suspended",  "暂停"),
    ("terminated", "终止"),
]


class GanttExampleDrug(models.Model):
    """药品主档。一个品种可在多个 TA 方向推进。"""

    _name = "gantt.example.drug"
    _description = "Gantt Example: Drug"
    _order = "name"

    name = fields.Char(string="药品名称", required=True)
    generic_name = fields.Char(string="通用名")
    molecule_type = fields.Selection(
        selection=[
            ("small_molecule", "小分子化药"),
            ("biologic",       "生物制品"),
            ("tcm",            "中药"),
            ("cell_gene",      "细胞与基因治疗"),
        ],
        string="药物类型",
        default="small_molecule",
    )
    sponsor = fields.Char(string="申办方")
    responsible_id = fields.Many2one("res.users", string="项目负责人")
    notes = fields.Text(string="备注")

    ta_ids = fields.One2many(
        comodel_name="gantt.example.drug.ta",
        inverse_name="drug_id",
        string="治疗领域方向",
    )
    ta_count = fields.Integer(compute="_compute_ta_count", string="TA 数")

    def _compute_ta_count(self):
        for rec in self:
            rec.ta_count = len(rec.ta_ids)


class GanttExampleDrugTa(models.Model):
    """药品 × 治疗领域（TA）组合。
    主甘特图的每一条 bar 对应一个 TA 方向；
    点击 bar 弹出 dialog 展示该 TA 下的所有临床试验。
    """

    _name = "gantt.example.drug.ta"
    _description = "Gantt Example: Drug × Therapeutic Area"
    _order = "date_start, therapeutic_area"

    drug_id = fields.Many2one(
        "gantt.example.drug",
        string="药品",
        required=True,
        ondelete="cascade",
    )
    therapeutic_area = fields.Selection(
        selection=THERAPEUTIC_AREAS,
        string="治疗领域（TA）",
        required=True,
    )
    highest_phase = fields.Selection(
        selection=PHASE_TYPES,
        string="当前最高阶段",
        compute="_compute_highest_phase",
        store=True,
    )
    # 时间跨度由子 trial 自动汇总，也允许手动覆盖
    date_start = fields.Date(
        string="启动日期",
        compute="_compute_dates",
        store=True,
        readonly=False,
    )
    date_stop = fields.Date(
        string="预计结束",
        compute="_compute_dates",
        store=True,
        readonly=False,
    )
    trial_ids = fields.One2many(
        comodel_name="gantt.example.trial",
        inverse_name="drug_ta_id",
        string="临床试验",
    )
    trial_count = fields.Integer(compute="_compute_trial_count", string="试验数")

    def _compute_display_name(self):
        ta_map    = dict(THERAPEUTIC_AREAS)
        phase_map = dict(PHASE_TYPES)
        for rec in self:
            ta    = ta_map.get(rec.therapeutic_area, rec.therapeutic_area or "?")
            phase = phase_map.get(rec.highest_phase, "") if rec.highest_phase else ""
            rec.display_name = f"{ta}  |  {phase}" if phase else ta

    @api.depends("trial_ids.phase_type")
    def _compute_highest_phase(self):
        order = [p[0] for p in PHASE_TYPES]
        for rec in self:
            phases = [t.phase_type for t in rec.trial_ids if t.phase_type]
            if phases:
                rec.highest_phase = max(phases, key=lambda p: order.index(p) if p in order else -1)
            else:
                rec.highest_phase = False

    @api.depends("trial_ids.date_start", "trial_ids.date_stop")
    def _compute_dates(self):
        for rec in self:
            starts = [t.date_start for t in rec.trial_ids if t.date_start]
            stops  = [t.date_stop  for t in rec.trial_ids if t.date_stop]
            if not rec.date_start and starts:
                rec.date_start = min(starts)
            if not rec.date_stop and stops:
                rec.date_stop = max(stops)

    def _compute_trial_count(self):
        for rec in self:
            rec.trial_count = len(rec.trial_ids)


class GanttExampleTrial(models.Model):
    """单个临床试验。属于某药品的某 TA 方向。
    在点击 TA bar 弹出的 dialog 甘特图中呈现。
    """

    _name = "gantt.example.trial"
    _description = "Gantt Example: Clinical Trial"
    _order = "date_start, phase_type"

    name = fields.Char(string="试验名称", required=True)
    drug_ta_id = fields.Many2one(
        "gantt.example.drug.ta",
        string="药品 / TA",
        required=True,
        ondelete="cascade",
    )
    drug_id = fields.Many2one(
        related="drug_ta_id.drug_id",
        string="药品",
        store=True,
    )
    therapeutic_area = fields.Selection(
        related="drug_ta_id.therapeutic_area",
        string="治疗领域",
        store=True,
    )
    phase_type = fields.Selection(
        selection=PHASE_TYPES,
        string="试验阶段",
        required=True,
    )
    status = fields.Selection(
        selection=STATUS_TYPES,
        string="状态",
        default="planned",
    )
    date_start = fields.Date(string="开始日期", required=True)
    date_stop  = fields.Date(string="结束日期",  required=True)
    regulatory_body = fields.Selection(
        selection=[
            ("nmpa",  "NMPA"),
            ("fda",   "FDA"),
            ("ema",   "EMA"),
            ("multi", "多国"),
        ],
        string="监管机构",
        default="nmpa",
    )
    site_count    = fields.Integer(string="研究中心数")
    subject_count = fields.Integer(string="受试者人数")
    pi            = fields.Char(string="主要研究者（PI）")
    notes         = fields.Text(string="备注")
