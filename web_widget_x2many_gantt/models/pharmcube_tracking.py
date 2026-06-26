import logging
import threading
from datetime import datetime

from odoo import api, fields, models

_logger = logging.getLogger(__name__)

_sync_local = threading.local()

_DATE_FMTS = ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%Y%m%d")


def _parse_date(val):
    if not val:
        return False
    s = str(val).strip()[:10]
    for fmt in _DATE_FMTS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return False


class PharmcubeTracking(models.Model):
    _name = "pharmcube.tracking"
    _description = "PharmCube Clinical Trial Tracking"
    _inherit = ["aws.glue.data.mixin"]
    _glue_key_column = "group_id"
    _order = "start_datetime, phase_revised"

    _glue_columns = [
        "group_id",
        "drug_id", "drug_name_cn", "drug_name_en",
        "targets", "moa", "originator", "global_highest_phase",
        "harbour_indication_name", "harbour_disease_area",
        "phase_revised", "overall_status_cn",
        "start_datetime", "completion_date", "first_posted_date",
        "nct_id", "title", "ispivotal", "target_population",
        "age_type", "min_age", "max_age",
        "actual_enrollment_global", "anticipated_enrollment_global",
        "intervention", "data_source",
        "indication_top_global_latest_stage",
        "pri_outcome_measures", "sec_outcome_measures",
        "outcome", "summary", "trial_url",
    ]

    # Relationship fields (not Glue columns)
    pharmcube_drug_id = fields.Many2one(
        "pharmcube.drug", string="药品", ondelete="cascade", index=True
    )
    ta_id = fields.Many2one(
        "pharmcube.drug.ta", string="疾病领域", ondelete="cascade", index=True
    )

    originator = fields.Char(string="原研企业")
    harbour_indication_name = fields.Char(string="适应症")
    harbour_disease_area = fields.Char(string="疾病领域")
    phase_revised = fields.Char(string="研发阶段")
    overall_status_cn = fields.Char(string="试验状态")
    nct_id = fields.Char(string="NCT/CTR ID")
    title = fields.Char(string="试验标题")
    target_population = fields.Char(string="目标人群")
    age_type = fields.Char(string="年龄类型")
    min_age = fields.Char(string="最小年龄")
    max_age = fields.Char(string="最大年龄")
    actual_enrollment_global = fields.Char(string="全球实际入组")
    anticipated_enrollment_global = fields.Char(string="全球计划入组")
    intervention = fields.Char(string="干预药物")
    data_source = fields.Char(string="数据来源")

    pri_outcome_measures = fields.Text(string="主要终点")
    sec_outcome_measures = fields.Text(string="次要终点")

    outcome = fields.Text(string="终点结果摘要")
    summary = fields.Text(string="结果摘要")
    trial_url = fields.Char(string="试验注册链接")

    start_datetime = fields.Date(string="启动日期")
    completion_date = fields.Date(string="完成日期")
    first_posted_date = fields.Date(string="首次登记日期")

    ispivotal = fields.Boolean(string="关键试验")

    @api.depends("harbour_indication_name", "phase_revised")
    def _compute_display_name(self):
        for rec in self:
            parts = [rec.harbour_indication_name or "", rec.phase_revised or ""]
            rec.display_name = "  |  ".join(p for p in parts if p) or "/"

    # --- Sync override: preload drug/TA caches to avoid per-row DB queries ---

    @api.model
    def _sync_from_glue_table(self, glue_table, row_iter) -> int:
        self._load_sync_caches()
        try:
            return super()._sync_from_glue_table(glue_table, row_iter)
        finally:
            self._clear_sync_caches()

    def _load_sync_caches(self):
        """Load all existing drug/TA records into thread-local dicts once before the sync loop."""
        # Track which drug/TA records already had their drug-/indication-level
        # stage fields written this sync, so we refresh each once (first row wins)
        # instead of writing on every tracking row.
        _sync_local.drug_phase_done = set()
        _sync_local.ta_stage_done = set()
        _sync_local.drug_id_map = {}
        _sync_local.drug_name_map = {}
        for row in self.env["pharmcube.drug"].search_read(
            [], ["drug_id", "drug_name_cn"]
        ):
            if row["drug_id"]:
                _sync_local.drug_id_map[row["drug_id"]] = row["id"]
            if row["drug_name_cn"]:
                _sync_local.drug_name_map[row["drug_name_cn"]] = row["id"]

        _sync_local.ta_map = {}
        for row in self.env["pharmcube.drug.ta"].search_read(
            [], ["drug_id", "name"]
        ):
            drug_db_id = row["drug_id"][0] if row["drug_id"] else None
            if drug_db_id and row["name"]:
                _sync_local.ta_map[(drug_db_id, row["name"])] = row["id"]

    def _clear_sync_caches(self):
        for attr in ("drug_id_map", "drug_name_map", "ta_map",
                     "drug_phase_done", "ta_stage_done"):
            _sync_local.__dict__.pop(attr, None)

    def _resolve_drug(self, row):
        """Return pharmcube.drug DB id for this row, creating if needed."""
        drug_id_str = (row.get("drug_id") or "").strip()
        drug_name_cn = (row.get("drug_name_cn") or "").strip()
        drug_name_en = (row.get("drug_name_en") or "").strip()
        name = drug_name_cn or drug_name_en
        if not name:
            return False

        global_phase = (row.get("global_highest_phase") or "").strip()
        drug_id_map = _sync_local.drug_id_map
        drug_name_map = _sync_local.drug_name_map

        drug_db_id = False
        if drug_id_str and drug_id_str in drug_id_map:
            drug_db_id = drug_id_map[drug_id_str]
        elif name in drug_name_map:
            drug_db_id = drug_name_map[name]

        if drug_db_id:
            self._update_drug_phase(drug_db_id, global_phase)
            return drug_db_id

        rec = self.env["pharmcube.drug"].create({
            "drug_id": drug_id_str or False,
            "drug_name_cn": name,
            "drug_name_en": drug_name_en or False,
            "targets": row.get("targets") or False,
            "moa": row.get("moa") or False,
            "originator": row.get("originator") or False,
            "global_highest_phase": global_phase or False,
        })
        _sync_local.drug_phase_done.add(rec.id)
        if drug_id_str:
            drug_id_map[drug_id_str] = rec.id
        drug_name_map[name] = rec.id
        return rec.id

    def _update_drug_phase(self, drug_db_id, global_phase):
        """Refresh global_highest_phase on an existing drug, once per sync."""
        done = _sync_local.drug_phase_done
        if drug_db_id in done:
            return
        done.add(drug_db_id)
        if global_phase:
            self.env["pharmcube.drug"].browse(drug_db_id).global_highest_phase = global_phase

    def _resolve_ta(self, drug_db_id, disease_area, row):
        """Return pharmcube.drug.ta DB id, creating if needed.

        Also populates the indication-level latest-stage fields on the TA.
        """
        if not drug_db_id or not disease_area:
            return False

        global_stage = (row.get("indication_top_global_latest_stage") or "").strip()

        ta_map = _sync_local.ta_map
        key = (drug_db_id, disease_area)
        if key in ta_map:
            ta_db_id = ta_map[key]
            self._update_ta_stage(ta_db_id, global_stage)
            return ta_db_id

        rec = self.env["pharmcube.drug.ta"].create({
            "drug_id": drug_db_id,
            "name": disease_area,
            "indication_top_global_latest_stage": global_stage or False,
        })
        _sync_local.ta_stage_done.add(rec.id)
        ta_map[key] = rec.id
        return rec.id

    def _update_ta_stage(self, ta_db_id, global_stage):
        """Refresh indication-level global stage on an existing TA, once per sync."""
        done = _sync_local.ta_stage_done
        if ta_db_id in done:
            return
        done.add(ta_db_id)
        if global_stage:
            ta = self.env["pharmcube.drug.ta"].browse(ta_db_id)
            ta.indication_top_global_latest_stage = global_stage

    def _post_sync(self, total: int) -> None:
        """After sync: remove orphan TAs and repair tracking records missing ta_id."""
        # 1. Delete TAs that have no tracking records linked
        orphan_tas = self.env["pharmcube.drug.ta"].search(
            [("tracking_ids", "=", False)]
        )
        if orphan_tas:
            _logger.info(
                "Glue post-sync: deleting %d orphan TA records", len(orphan_tas)
            )
            orphan_tas.unlink()

        # 2. Repair tracking records where ta_id is False but harbour_disease_area is set
        broken = self.with_context(active_test=False).search(
            [("ta_id", "=", False), ("pharmcube_drug_id", "!=", False),
             ("harbour_disease_area", "!=", False)]
        )
        if broken:
            _logger.info(
                "Glue post-sync: repairing ta_id on %d tracking records", len(broken)
            )
            ta_model = self.env["pharmcube.drug.ta"]
            # Build a quick lookup of existing TAs
            ta_map = {
                (r["drug_id"][0], r["name"]): r["id"]
                for r in ta_model.search_read([], ["drug_id", "name"])
            }
            for rec in broken:
                drug_id = rec.pharmcube_drug_id.id
                area = rec.harbour_disease_area.strip()
                key = (drug_id, area)
                if key not in ta_map:
                    ta = ta_model.create({"drug_id": drug_id, "name": area})
                    ta_map[key] = ta.id
                rec.ta_id = ta_map[key]

    def _map_glue_row(self, row):
        drug_db_id = self._resolve_drug(row)
        disease_area = (row.get("harbour_disease_area") or "").strip()
        ta_db_id = self._resolve_ta(drug_db_id, disease_area, row)

        str_fields = [
            "originator",
            "harbour_indication_name", "harbour_disease_area",
            "phase_revised", "overall_status_cn",
            "nct_id", "title", "target_population",
            "age_type", "min_age", "max_age",
            "actual_enrollment_global", "anticipated_enrollment_global",
            "intervention", "data_source",
            "pri_outcome_measures", "sec_outcome_measures",
            "outcome", "summary", "trial_url",
        ]
        result = {f: row.get(f) or False for f in str_fields}

        date_start = _parse_date(row.get("start_datetime"))
        date_stop = _parse_date(row.get("completion_date"))
        first_posted = _parse_date(row.get("first_posted_date"))

        result.update({
            "pharmcube_drug_id": drug_db_id or False,
            "ta_id": ta_db_id or False,
            "start_datetime": date_start or (first_posted if not date_stop else False),
            "completion_date": date_stop,
            "first_posted_date": first_posted,
            "ispivotal": (row.get("ispivotal") or "").upper().strip() == "Y",
        })
        return result
