from odoo import api, fields, models


class ThreeDModelExample(models.Model):
    """Demo model to showcase the 3D viewer widget."""

    _name = "threed.model.example"
    _description = "3D Model Example"

    name = fields.Char(string="Name", required=True)
    model_file = fields.Binary(string="3D Model File", attachment=True)
    model_filename = fields.Char(string="Filename")
    description = fields.Text(string="Description")
    file_format = fields.Selection(
        selection=[
            ("stl", "STL"),
            ("obj", "OBJ"),
            ("gltf", "GLTF"),
            ("glb", "GLB"),
        ],
        string="Format",
        compute="_compute_file_format",
        store=True,
    )

    @api.depends("model_filename")
    def _compute_file_format(self):
        for record in self:
            if record.model_filename:
                ext = record.model_filename.rsplit(".", 1)[-1].lower()
                if ext in ("stl", "obj", "gltf", "glb"):
                    record.file_format = ext
                else:
                    record.file_format = False
            else:
                record.file_format = False
