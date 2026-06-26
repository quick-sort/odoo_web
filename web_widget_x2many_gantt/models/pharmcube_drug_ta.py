from odoo import api, fields, models

# Phase values that are not real clinical phases and should not be used
# as the TA's representative phase / bar color.
_INVALID_PHASES = {"not applicable", "n/a", "na", "not provided", "unknown", "none"}

# Clinical development order, lowest → highest. Used to pick the most advanced
# phase for `phase_end` instead of ordering by completion date.
_PHASE_RANK = {
    "preclinical": 0,
    "phase 0": 1,
    "phase i": 2,
    "phase 1": 2,
    "phase i/ii": 3,
    "phase 1/2": 3,
    "phase ii": 4,
    "phase 2": 4,
    "phase ii/iii": 5,
    "phase 2/3": 5,
    "phase iii": 6,
    "phase 3": 6,
    "nda": 7,
    "bla": 7,
    "registration": 7,
    "approved": 8,
    "phase iv": 9,
    "phase 4": 9,
}


def _is_valid_phase(phase):
    return bool(phase) and phase.strip().lower() not in _INVALID_PHASES


def _phase_rank(phase):
    return _PHASE_RANK.get((phase or "").strip().lower(), -1)


class PharmcubeDrugTA(models.Model):
    _name = "pharmcube.drug.ta"
    _description = "PharmCube Drug Therapeutic Area"
    _rec_name = "name"
    _order = "drug_id, name"

    drug_id = fields.Many2one(
        "pharmcube.drug", required=True, ondelete="cascade", index=True
    )
    name = fields.Char(string="疾病领域", required=True)

    # Indication-level stage (one value per disease area; populated during Glue sync).
    indication_top_global_latest_stage = fields.Char(string="全球最新阶段")

    tracking_ids = fields.One2many("pharmcube.tracking", "ta_id", string="临床试验追踪")
    tracking_count = fields.Integer(compute="_compute_tracking_count")

    date_start = fields.Date(compute="_compute_dates", store=True)
    date_end = fields.Date(compute="_compute_dates", store=True)

    # Phase at earliest start and latest end — shown on the gantt bar.
    # Not stored: computed on read so values always reflect current trackings
    # (and never persist a stale "Not Applicable").
    phase_start = fields.Char(
        string="最早阶段", compute="_compute_phases"
    )
    phase_end = fields.Char(
        string="最晚阶段", compute="_compute_phases"
    )
    bar_label = fields.Char(
        string="甘特图标签", compute="_compute_bar_label"
    )

    @api.depends(
        "tracking_ids.start_datetime",
        "tracking_ids.completion_date",
    )
    def _compute_dates(self):
        for rec in self:
            starts = rec.tracking_ids.filtered("start_datetime").mapped("start_datetime")
            ends = rec.tracking_ids.filtered("completion_date").mapped("completion_date")
            rec.date_start = min(starts) if starts else False
            rec.date_end = max(ends) if ends else False

    @api.depends("tracking_ids.phase_revised")
    def _compute_phases(self):
        for rec in self:
            # Only consider trackings with a real clinical phase, so the TA
            # bar never shows "Not Applicable" and similar non-phases.
            valid = rec.tracking_ids.filtered(
                lambda t: _is_valid_phase(t.phase_revised)
            )

            # phase_start / phase_end are the lowest / highest clinical phase
            # (Phase I/II/III/IV order), not ordered by start / completion date.
            if valid:
                rec.phase_start = min(
                    valid, key=lambda t: _phase_rank(t.phase_revised)
                ).phase_revised
                rec.phase_end = max(
                    valid, key=lambda t: _phase_rank(t.phase_revised)
                ).phase_revised
            else:
                rec.phase_start = False
                rec.phase_end = False

    @api.depends("name", "phase_start", "phase_end")
    def _compute_bar_label(self):
        for rec in self:
            p_start = rec.phase_start or ""
            p_end = rec.phase_end or ""
            if p_start and p_end and p_start != p_end:
                phase_str = f"{p_start} → {p_end}"
            else:
                phase_str = p_start or p_end
            rec.bar_label = f"{rec.name}  [{phase_str}]" if phase_str else rec.name

    @api.depends("tracking_ids")
    def _compute_tracking_count(self):
        for rec in self:
            rec.tracking_count = len(rec.tracking_ids)

    @api.model
    def _get_or_create(self, drug, disease_area):
        if not drug or not disease_area:
            return self.browse()
        ta = self.search(
            [("drug_id", "=", drug.id), ("name", "=", disease_area)], limit=1
        )
        if ta:
            return ta
        return self.create({"drug_id": drug.id, "name": disease_area})
