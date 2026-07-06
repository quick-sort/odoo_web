{
    "name": "DAG View",
    "version": "19.0.1.0.0",
    "category": "Web",
    "summary": "Visualize record dependencies as a directed acyclic graph",
    "description": """
DAG View
========

A custom Odoo view type that visualizes record relationships as a Directed
Acyclic Graph (DAG). Each node represents a database record, and edges
represent dependencies between records (via Many2many or One2many fields).

Features:
- Automatic hierarchical layout using the dagre algorithm (via Cytoscape.js)
- Click on nodes to open the corresponding record form
- Configurable layout direction (top-bottom, left-right, etc.)
- Color-coded nodes based on a selection/many2one field
- Zoom, pan, and fit-to-screen interactions
- Integrates with Odoo's standard search/filter system

Usage example (in XML view definition)::

    <dag edge_field="depend_ids" direction="TB" color_field="stage_id">
        <field name="name"/>
        <field name="depend_ids"/>
        <field name="stage_id"/>
    </dag>

Arch attributes:
- edge_field: The Many2many/One2many field that defines edges (required)
- direction: Layout direction - TB (top-bottom), BT, LR, RL (default: TB)
- color_field: A selection or many2one field to color-code nodes
- label_field: The field to display as node label (default: display_name)
    """,
    "author": "Odoo Web Extensions",
    "license": "LGPL-3",
    "depends": ["web", "project"],
    "data": [
        "views/project_task_dag_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "web_dag/static/lib/cytoscape.min.js",
            "web_dag/static/lib/dagre.min.js",
            "web_dag/static/lib/cytoscape-dagre.min.js",
            "web_dag/static/src/dag_view.js",
            "web_dag/static/src/dag_view.xml",
            "web_dag/static/src/dag_view.scss",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": False,
}
