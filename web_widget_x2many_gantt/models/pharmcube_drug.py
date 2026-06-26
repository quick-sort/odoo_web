from odoo import api, fields, models


class PharmcubeDrug(models.Model):
    _name = "pharmcube.drug"
    _description = "PharmCube Drug"
    _rec_name = "drug_name_cn"
    _order = "drug_name_cn"

    # Field names match Glue table columns
    drug_id = fields.Char(string="PharmCube Drug ID", index=True)
    drug_name_cn = fields.Char(string="药品名称（中文）", required=True)
    drug_name_en = fields.Char(string="Drug Name (EN)")
    targets = fields.Char(string="靶点")
    moa = fields.Char(string="作用机制")
    originator = fields.Char(string="原研企业")
    global_highest_phase = fields.Char(string="全球最高研发阶段")

    ta_ids = fields.One2many("pharmcube.drug.ta", "drug_id", string="疾病领域")
    tracking_ids = fields.One2many("pharmcube.tracking", "pharmcube_drug_id", string="临床试验追踪")
    tracking_count = fields.Integer(compute="_compute_tracking_count", string="记录数")

    @api.depends("tracking_ids")
    def _compute_tracking_count(self):
        for rec in self:
            rec.tracking_count = len(rec.tracking_ids)

    @api.model
    def _get_or_create(self, row):
        drug_id = (row.get("drug_id") or "").strip()
        drug_name_cn = (row.get("drug_name_cn") or "").strip()
        drug_name_en = (row.get("drug_name_en") or "").strip()
        name = drug_name_cn or drug_name_en
        if not name:
            return self.browse()

        if drug_id:
            drug = self.search([("drug_id", "=", drug_id)], limit=1)
            if drug:
                return drug

        drug = self.search([("drug_name_cn", "=", name)], limit=1)
        if drug:
            return drug

        return self.create({
            "drug_id": drug_id or False,
            "drug_name_cn": name,
            "drug_name_en": drug_name_en or False,
            "targets": row.get("targets") or False,
            "moa": row.get("moa") or False,
            "originator": row.get("originator") or False,
            "global_highest_phase": row.get("global_highest_phase") or False,
        })
