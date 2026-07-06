{
    "name": "3D Model Viewer Widget",
    "version": "19.0.1.0.0",
    "category": "Web",
    "summary": "Preview 3D models (STL/OBJ/GLTF) stored in Binary fields",
    "description": """
3D Model Viewer Widget
======================

A field widget that renders interactive 3D model previews from binary file
data stored in Odoo fields. Ideal for product 3D printing previews,
CAD model visualization, and any workflow involving 3D assets.

Supported formats:
- STL (binary and ASCII)
- OBJ (Wavefront)
- GLTF / GLB (glTF 2.0)

Features:
- Interactive orbit controls (rotate, zoom, pan)
- Auto-framing to fit the model in the viewport
- Configurable background, lighting, and camera
- Fullscreen toggle
- File upload via drag-and-drop or file picker
- Works on any Binary field

Usage in XML view::

    <field name="model_file" widget="3d_viewer"/>

With options::

    <field name="model_file" widget="3d_viewer"
           options="{'height': 500, 'background': '#1a1a2e', 'auto_rotate': true}"/>

Options:
- height: Viewer height in pixels (default: 400)
- background: Background color hex string (default: '#f0f0f0')
- auto_rotate: Enable auto-rotation (default: false)
- wireframe: Show wireframe overlay (default: false)
- grid: Show ground grid (default: true)
    """,
    "author": "Odoo Web Extensions",
    "license": "LGPL-3",
    "depends": ["web"],
    "data": [
        "security/ir.model.access.csv",
        "views/threed_model_example_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            # Three.js core (UMD global build)
            "web_widget_3d_viewer/static/lib/three.min.js",
            "web_widget_3d_viewer/static/lib/OrbitControls.js",
            "web_widget_3d_viewer/static/lib/STLLoader.js",
            "web_widget_3d_viewer/static/lib/OBJLoader.js",
            "web_widget_3d_viewer/static/lib/GLTFLoader.js",
            # Widget
            "web_widget_3d_viewer/static/src/threed_viewer_field.js",
            "web_widget_3d_viewer/static/src/threed_viewer_field.xml",
            "web_widget_3d_viewer/static/src/threed_viewer_field.scss",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": False,
}
