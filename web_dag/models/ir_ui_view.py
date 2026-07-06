from odoo import fields, models


class IrUiView(models.Model):
    _inherit = "ir.ui.view"

    type = fields.Selection(
        selection_add=[("dag", "DAG")],
        ondelete={"dag": "cascade"},
    )

    def _get_view_info(self):
        result = super()._get_view_info()
        if "dag" not in result:
            result["dag"] = {"icon": "fa fa-project-diagram"}
        return result
