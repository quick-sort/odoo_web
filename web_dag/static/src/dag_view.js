/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Layout } from "@web/search/layout";
import { Component, onWillStart, onMounted, onWillUnmount, useRef, useState, onWillUpdateProps } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

// ============================================================================
// DAG Renderer - Handles Cytoscape.js graph rendering
// ============================================================================

export class DagRenderer extends Component {
    static template = "web_dag.DagRenderer";
    static props = {
        records: { type: Array },
        edgeField: { type: String },
        direction: { type: String, optional: true },
        colorField: { type: String, optional: true },
        labelField: { type: String, optional: true },
        onNodeClick: { type: Function },
    };

    setup() {
        this.containerRef = useRef("dagContainer");
        this.cy = null;

        onMounted(() => this.initGraph());
        onWillUnmount(() => this.destroyGraph());
        onWillUpdateProps((nextProps) => {
            // Schedule a redraw after props update
            if (nextProps.records !== this.props.records) {
                Promise.resolve().then(() => this.updateGraph());
            }
        });

        // Listen for fit-to-screen events from the controller
        this._fitHandler = () => this.fitGraph();
        window.addEventListener("dag-fit-to-screen", this._fitHandler);
    }

    // Color palette for nodes
    get colorPalette() {
        return [
            "#875a7b", // purple
            "#00a09d", // teal
            "#f06050", // red
            "#6cc1ed", // blue
            "#f4a460", // sandy
            "#30c381", // green
            "#9c27b0", // deep purple
            "#ff9800", // orange
            "#607d8b", // grey-blue
            "#e91e63", // pink
            "#795548", // brown
            "#009688", // dark teal
        ];
    }

    /**
     * Build Cytoscape elements (nodes + edges) from records.
     */
    buildElements() {
        const { records, edgeField, colorField, labelField } = this.props;
        const nodes = [];
        const edges = [];
        const recordIds = new Set(records.map((r) => r.id));

        // Track color mapping
        const colorMap = new Map();
        let colorIndex = 0;

        for (const record of records) {
            // Determine node label
            let label = record.display_name || `#${record.id}`;
            if (labelField && record[labelField]) {
                const val = record[labelField];
                // Handle many2one [id, name] tuples
                label = Array.isArray(val) ? val[1] : String(val);
            }

            // Determine node color
            let color = this.colorPalette[0];
            if (colorField && record[colorField] !== undefined && record[colorField] !== false) {
                const colorVal = record[colorField];
                // For many2one: use the id; for selection: use the value
                const colorKey = Array.isArray(colorVal) ? colorVal[0] : colorVal;
                if (!colorMap.has(colorKey)) {
                    colorMap.set(colorKey, this.colorPalette[colorIndex % this.colorPalette.length]);
                    colorIndex++;
                }
                color = colorMap.get(colorKey);
            }

            // Determine subtitle (color field display name)
            let subtitle = "";
            if (colorField && record[colorField]) {
                const val = record[colorField];
                subtitle = Array.isArray(val) ? val[1] : String(val);
            }

            nodes.push({
                data: {
                    id: `node_${record.id}`,
                    recordId: record.id,
                    label: label,
                    subtitle: subtitle,
                    color: color,
                },
            });

            // Build edges from the edge field
            const edgeValue = record[edgeField];
            if (edgeValue && Array.isArray(edgeValue)) {
                for (const targetId of edgeValue) {
                    // Only add edge if the target is in our record set
                    if (recordIds.has(targetId)) {
                        edges.push({
                            data: {
                                id: `edge_${record.id}_${targetId}`,
                                source: `node_${targetId}`,
                                target: `node_${record.id}`,
                            },
                        });
                    }
                }
            }
        }

        return [...nodes, ...edges];
    }

    /**
     * Get the Cytoscape stylesheet for nodes and edges.
     */
    getStylesheet() {
        return [
            {
                selector: "node",
                style: {
                    "background-color": "data(color)",
                    label: "data(label)",
                    "text-valign": "center",
                    "text-halign": "center",
                    "text-wrap": "wrap",
                    "text-max-width": "120px",
                    color: "#fff",
                    "font-size": "11px",
                    "font-weight": "bold",
                    width: "140px",
                    height: "50px",
                    shape: "roundrectangle",
                    "border-width": "2px",
                    "border-color": "data(color)",
                    "border-opacity": 0.8,
                    "text-outline-width": "0px",
                    "padding": "10px",
                },
            },
            {
                selector: "node:active",
                style: {
                    "overlay-opacity": 0.1,
                },
            },
            {
                selector: "node:selected",
                style: {
                    "border-width": "3px",
                    "border-color": "#212529",
                },
            },
            {
                selector: "edge",
                style: {
                    width: 2,
                    "line-color": "#adb5bd",
                    "target-arrow-color": "#6c757d",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "arrow-scale": 1.2,
                },
            },
            {
                selector: "edge:selected",
                style: {
                    "line-color": "#495057",
                    "target-arrow-color": "#495057",
                    width: 3,
                },
            },
        ];
    }

    /**
     * Initialize Cytoscape instance.
     */
    initGraph() {
        const container = this.containerRef.el;
        if (!container) return;

        // cytoscape-dagre auto-registers when loaded after cytoscape and dagre globals.
        // As a safety fallback, manually register if needed.
        const cy = window.cytoscape;
        if (cy && window.cytoscapeDagre && !cy.extensions?.layout?.dagre) {
            cy.use(window.cytoscapeDagre);
        }

        const elements = this.buildElements();
        const direction = this.props.direction || "TB";

        this.cy = cytoscape({
            container: container,
            elements: elements,
            style: this.getStylesheet(),
            layout: {
                name: "dagre",
                rankDir: direction,
                nodeSep: 60,
                rankSep: 80,
                edgeSep: 30,
                animate: true,
                animationDuration: 300,
            },
            // Interaction options
            minZoom: 0.2,
            maxZoom: 3,
            wheelSensitivity: 0.3,
            boxSelectionEnabled: false,
            autoungrabify: true, // nodes not draggable
        });

        // Node click handler - open the record
        this.cy.on("tap", "node", (evt) => {
            const recordId = evt.target.data("recordId");
            if (recordId) {
                this.props.onNodeClick(recordId);
            }
        });

        // Fit graph to viewport after layout
        this.cy.on("layoutstop", () => {
            this.cy.fit(undefined, 40);
        });

        // Show pointer cursor on node hover
        this.cy.on("mouseover", "node", () => {
            container.style.cursor = "pointer";
        });
        this.cy.on("mouseout", "node", () => {
            container.style.cursor = "default";
        });
    }

    /**
     * Update graph with new data (re-render).
     */
    updateGraph() {
        if (!this.cy) {
            this.initGraph();
            return;
        }

        const elements = this.buildElements();
        const direction = this.props.direction || "TB";

        this.cy.elements().remove();
        this.cy.add(elements);
        this.cy.layout({
            name: "dagre",
            rankDir: direction,
            nodeSep: 60,
            rankSep: 80,
            edgeSep: 30,
            animate: true,
            animationDuration: 300,
        }).run();
    }

    /**
     * Fit graph to viewport.
     */
    fitGraph() {
        if (this.cy) {
            this.cy.fit(undefined, 40);
        }
    }

    /**
     * Destroy Cytoscape instance.
     */
    destroyGraph() {
        if (this._fitHandler) {
            window.removeEventListener("dag-fit-to-screen", this._fitHandler);
        }
        if (this.cy) {
            this.cy.destroy();
            this.cy = null;
        }
    }
}

// ============================================================================
// DAG Controller - Main view component
// ============================================================================

export class DagController extends Component {
    static template = "web_dag.DagController";
    static components = { DagRenderer };

    setup() {
        this.actionService = useService("action");
        this.orm = useService("orm");
        this.notification = useService("notification");

        // Parse arch attributes
        this.archInfo = this.parseArch();

        this.state = useState({
            records: [],
            isLoading: false,
        });

        onWillStart(async () => await this.loadData());
        onWillUpdateProps(async (nextProps) => {
            if (
                JSON.stringify(nextProps.domain) !== JSON.stringify(this.props.domain)
            ) {
                await this.loadData(nextProps);
            }
        });
    }

    /**
     * Parse the XML arch element for DAG-specific attributes.
     */
    parseArch() {
        const arch = this.props.arch;
        const info = {
            edgeField: "depend_ids",
            direction: "TB",
            colorField: false,
            labelField: false,
            fieldNames: [],
        };

        if (arch) {
            info.edgeField = arch.getAttribute("edge_field") || "depend_ids";
            info.direction = arch.getAttribute("direction") || "TB";
            info.colorField = arch.getAttribute("color_field") || false;
            info.labelField = arch.getAttribute("label_field") || false;

            // Collect field names from <field> elements
            const fieldNodes = arch.querySelectorAll("field");
            for (const fieldNode of fieldNodes) {
                const name = fieldNode.getAttribute("name");
                if (name) {
                    info.fieldNames.push(name);
                }
            }

            // Ensure edge_field is always in the fields list
            if (!info.fieldNames.includes(info.edgeField)) {
                info.fieldNames.push(info.edgeField);
            }
            // Ensure color_field is in the list if specified
            if (info.colorField && !info.fieldNames.includes(info.colorField)) {
                info.fieldNames.push(info.colorField);
            }
            // Ensure label_field is in the list if specified
            if (info.labelField && !info.fieldNames.includes(info.labelField)) {
                info.fieldNames.push(info.labelField);
            }
        }

        return info;
    }

    /**
     * Load records from the server.
     */
    async loadData(props = this.props) {
        this.state.isLoading = true;
        try {
            const fields = this.archInfo.fieldNames.length
                ? this.archInfo.fieldNames
                : ["display_name", this.archInfo.edgeField];

            // Always include display_name
            if (!fields.includes("display_name")) {
                fields.push("display_name");
            }

            const records = await this.orm.searchRead(
                props.resModel,
                props.domain || [],
                fields,
                { limit: 500 }
            );

            this.state.records = records;
        } catch (error) {
            this.notification.add("Failed to load DAG data", { type: "danger" });
            console.error("DAG data load error:", error);
        } finally {
            this.state.isLoading = false;
        }
    }

    /**
     * Handle node click - open the record form.
     */
    onNodeClick(recordId) {
        this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: this.props.resModel,
            res_id: recordId,
            views: [[false, "form"]],
            target: "current",
        });
    }

    /**
     * Refresh data from server.
     */
    async refresh() {
        await this.loadData();
    }

    /**
     * Fit graph to viewport.
     */
    fitToScreen() {
        // Dispatch a custom event that the renderer listens to
        const evt = new CustomEvent("dag-fit-to-screen");
        window.dispatchEvent(evt);
    }
}

// ============================================================================
// DAG View - Top-level view component with Layout
// ============================================================================

export class DagView extends Component {
    static template = "web_dag.DagView";
    static components = { Layout, DagController };

    setup() {}

    getControllerProps() {
        return {
            resModel: this.props.resModel,
            domain: this.props.domain,
            context: this.props.context,
            arch: this.props.arch,
        };
    }
}

// ============================================================================
// View Registry
// ============================================================================

export const dagView = {
    type: "dag",
    display_name: "DAG",
    icon: "fa-project-diagram",
    multiRecord: true,
    searchMenuTypes: ["filter", "groupBy", "favorite"],
    Controller: DagController,
    Component: DagView,

    props: (genericProps, view) => {
        return {
            ...genericProps,
        };
    },
};

registry.category("views").add("dag", dagView);
