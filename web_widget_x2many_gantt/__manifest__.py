{
    "name": "X2Many Gantt Widget",
    "version": "19.0.1.0.0",
    "author": "quick-sort",
    "license": "LGPL-3",
    "category": "Hidden/Dependency",
    "summary": "Display one2many/many2many fields as a Gantt chart in form views",
    "description": """
        Provides a custom field widget ``x2many_gantt`` that renders a one2many
        or many2many field as an interactive Gantt chart instead of a list.

        Usage in form view::

            <field name="task_ids" widget="x2many_gantt"
                   date_start="date_start"
                   date_end="date_stop"
                   name_field="name"
                   default_scale="week">
                <list>
                    <field name="date_start"/>
                    <field name="date_stop"/>
                    <field name="name"/>
                </list>
            </field>

        Attributes:
        - date_start (required): field name for task start date/datetime
        - date_end   (required): field name for task end date/datetime
        - name_field (optional): field name for task label (default: "name")
        - default_scale (optional): day / week / month (default: week)
    """,
    "depends": ["web", "aws_glue"],
    "data": [
        "security/ir.model.access.csv",
        "views/gantt_example_views.xml",
        "views/pharmcube_views.xml",
    ],
    "demo": [
        "demo/gantt_example_demo.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "web_widget_x2many_gantt/static/src/components/x2many_gantt_field.js",
            "web_widget_x2many_gantt/static/src/components/x2many_gantt_field.xml",
            "web_widget_x2many_gantt/static/src/components/x2many_gantt_field.scss",
        ],
    },
    "installable": True,
    "auto_install": False,
    "application": True,
    "post_init_hook": "post_init_hook",
}
