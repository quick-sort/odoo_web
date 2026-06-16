/** @odoo-module **/

import { Component, onWillRender, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";

const { DateTime } = luxon;

// Odoo brand colors for gantt bars
const BAR_COLORS = [
    "#875A7B", "#3498DB", "#00A09D", "#E95454", "#F0AD4E",
    "#27AE60", "#9B59B6", "#1ABC9C", "#E67E22", "#2980B9",
];

const SCALE_CONFIG = {
    day:   { pxPerDay: 40,  minor: "day",   major: "month" },
    week:  { pxPerDay: 20,  minor: "week",  major: "month" },
    month: { pxPerDay: 1,   minor: "month", major: "year"  },
};

/**
 * Convert an Odoo field value (luxon DateTime, JS Date, string, or false) to a luxon DateTime.
 * Returns null when there is no value.
 */
function toDateTime(value) {
    if (!value) return null;
    if (value instanceof DateTime) return value;
    if (value instanceof Date) return DateTime.fromJSDate(value);
    if (typeof value === "string") return DateTime.fromISO(value);
    return null;
}

export class X2ManyGanttField extends Component {
    static template = "web_widget_x2many_gantt.GanttField";
    static props = {
        ...standardFieldProps,
        dateStart:     { type: String },
        dateEnd:       { type: String },
        nameField:     { type: String, optional: true },
        defaultScale:  { type: String, optional: true },
        tooltipFields: { type: Array, element: String, optional: true },
        barClickable:  { type: Boolean, optional: true },
    };

    setup() {
        this.state = useState({ scale: this.props.defaultScale || "week" });
        if (this.props.barClickable) {
            this.dialog = useService("dialog");
        }
        onWillRender(() => this._buildGanttData());
    }

    get list() {
        return this.props.record.data[this.props.name];
    }

    get records() {
        return this.list?.records || [];
    }

    // ── core computation ────────────────────────────────────────────────

    _buildGanttData() {
        const records = this.records;
        if (!records.length) {
            this.ganttData = null;
            return;
        }

        // Collect all valid date values to find the timeline bounds
        const allDates = [];
        for (const r of records) {
            const s = toDateTime(r.data[this.props.dateStart]);
            const e = toDateTime(r.data[this.props.dateEnd]);
            if (s) allDates.push(s);
            if (e) allDates.push(e);
        }
        if (!allDates.length) {
            this.ganttData = null;
            return;
        }

        const scale = this.state.scale;
        const cfg = SCALE_CONFIG[scale];

        // Raw bounds
        let minDate = DateTime.min(...allDates);
        let maxDate = DateTime.max(...allDates);

        // Expand to clean period boundaries + padding
        if (scale === "day") {
            minDate = minDate.startOf("day").minus({ days: 1 });
            maxDate = maxDate.endOf("day").plus({ days: 2 });
        } else if (scale === "week") {
            minDate = minDate.startOf("week").minus({ weeks: 1 });
            maxDate = maxDate.endOf("week").plus({ weeks: 1 });
        } else {
            minDate = minDate.startOf("month").minus({ months: 1 });
            maxDate = maxDate.endOf("month").plus({ months: 1 });
        }

        const totalPx = maxDate.diff(minDate, "days").days * cfg.pxPerDay;

        const { majorCells, minorCells } = this._buildHeaders(minDate, maxDate, scale, cfg.pxPerDay);
        const rows = this._buildRows(records, minDate, cfg.pxPerDay);

        // Today marker position
        const now = DateTime.now();
        const todayPx = (now >= minDate && now <= maxDate)
            ? now.diff(minDate, "days").days * cfg.pxPerDay
            : null;

        this.ganttData = { scale, totalPx, majorCells, minorCells, rows, todayPx };
    }

    _buildHeaders(minDate, maxDate, scale, pxPerDay) {
        const majorCells = [];
        const minorCells = [];

        if (scale === "day") {
            // Minor: one cell per day (40px each)
            let cur = minDate.startOf("day");
            while (cur < maxDate) {
                const next = cur.plus({ days: 1 });
                minorCells.push({
                    key: cur.toISO(),
                    label: cur.toFormat("d"),
                    width: pxPerDay,
                });
                cur = next;
            }
            // Major: group days by month
            cur = minDate.startOf("month");
            while (cur < maxDate) {
                const next = cur.plus({ months: 1 });
                const clampStart = DateTime.max(cur, minDate);
                const clampEnd   = DateTime.min(next, maxDate);
                const days = clampEnd.diff(clampStart, "days").days;
                majorCells.push({
                    key: cur.toISO(),
                    label: cur.toFormat("LLL yyyy"),
                    width: days * pxPerDay,
                });
                cur = next;
            }
        } else if (scale === "week") {
            // Minor: one cell per week (7 * pxPerDay each)
            let cur = minDate.startOf("week");
            while (cur < maxDate) {
                const next = cur.plus({ weeks: 1 });
                const visStart = DateTime.max(cur, minDate);
                const visEnd   = DateTime.min(next, maxDate);
                const days = visEnd.diff(visStart, "days").days;
                minorCells.push({
                    key: cur.toISO(),
                    label: "W" + cur.weekNumber,
                    width: days * pxPerDay,
                });
                cur = next;
            }
            // Major: group weeks by month (approximate by tracking week starts)
            cur = minDate.startOf("month");
            while (cur < maxDate) {
                const next = cur.plus({ months: 1 });
                const clampStart = DateTime.max(cur.startOf("week"), minDate.startOf("week"));
                const clampEnd   = next.startOf("week") < maxDate ? next.startOf("week") : maxDate;
                const days = clampEnd.diff(clampStart, "days").days;
                majorCells.push({
                    key: cur.toISO(),
                    label: cur.toFormat("LLL yyyy"),
                    width: days * pxPerDay,
                });
                cur = next;
            }
        } else {
            // scale === "month"
            // Minor: one cell per month
            let cur = minDate.startOf("month");
            while (cur < maxDate) {
                const next = cur.plus({ months: 1 });
                const clampStart = DateTime.max(cur, minDate);
                const clampEnd   = DateTime.min(next, maxDate);
                const days = clampEnd.diff(clampStart, "days").days;
                minorCells.push({
                    key: cur.toISO(),
                    label: cur.toFormat("LLL"),
                    width: days * pxPerDay,
                });
                cur = next;
            }
            // Major: group months by year
            cur = minDate.startOf("year");
            while (cur < maxDate) {
                const next = cur.plus({ years: 1 });
                const clampStart = DateTime.max(cur, minDate);
                const clampEnd   = DateTime.min(next, maxDate);
                const days = clampEnd.diff(clampStart, "days").days;
                majorCells.push({
                    key: cur.toISO(),
                    label: cur.toFormat("yyyy"),
                    width: days * pxPerDay,
                });
                cur = next;
            }
        }

        return { majorCells, minorCells };
    }

    _buildRows(records, minDate, pxPerDay) {
        const nameField = this.props.nameField || "name";
        return records.map((record, index) => {
            const startDt = toDateTime(record.data[this.props.dateStart]);
            const endDt   = toDateTime(record.data[this.props.dateEnd]);
            const name    = record.data[nameField]
                || record.data["display_name"]
                || `#${record.resId}`;

            let bar = null;
            if (startDt && endDt) {
                const leftDays  = startDt.diff(minDate, "days").days;
                const widthDays = endDt.diff(startDt, "days").days;
                bar = {
                    left:    Math.max(0, leftDays * pxPerDay),
                    width:   Math.max(4, widthDays * pxPerDay),
                    color:   BAR_COLORS[index % BAR_COLORS.length],
                    tooltip: this._buildTooltip(record, name, startDt, endDt),
                };
            }

            return { id: record.id || index, name, bar, record };
        });
    }

    /**
     * Build the tooltip string for a bar.
     *
     * When `tooltipFields` is provided, each field is rendered as "Label: Value".
     * Otherwise, fall back to "Name  Start → End".
     */
    _buildTooltip(record, name, startDt, endDt) {
        const fields = this.props.tooltipFields;
        if (!fields || !fields.length) {
            return `${name}\n${startDt.toFormat("yyyy-MM-dd")} → ${endDt.toFormat("yyyy-MM-dd")}`;
        }

        return fields.map((fieldName) => {
            const fieldDef = record.fields[fieldName];
            const label    = fieldDef?.string || fieldName;
            const value    = this._formatFieldValue(record, fieldName, fieldDef);
            return `${label}: ${value}`;
        }).join("\n");
    }

    _formatFieldValue(record, fieldName, fieldDef) {
        const raw = record.data[fieldName];
        if (raw === false || raw === undefined || raw === null) return "—";

        const type = fieldDef?.type;
        if (type === "many2one") {
            return Array.isArray(raw) ? raw[1] : String(raw);
        }
        if (type === "date" || type === "datetime") {
            const dt = toDateTime(raw);
            return dt ? dt.toFormat("yyyy-MM-dd") : String(raw);
        }
        if (type === "selection") {
            // resolve selection label from field definition
            const choice = (fieldDef.selection || []).find(([v]) => v === raw);
            return choice ? choice[1] : String(raw);
        }
        if (type === "boolean") {
            return raw ? "Yes" : "No";
        }
        return String(raw);
    }

    // ── UI helpers ──────────────────────────────────────────────────────

    setScale(scale) {
        this.state.scale = scale;
    }

    onBarClick(row) {
        if (!this.props.barClickable || !row.record?.resId) return;
        this.dialog.add(FormViewDialog, {
            resModel: this.list.resModel,
            resId: row.record.resId,
            title: row.name,
            preventCreate: true,
            size: "xl",
        });
    }

    get rowHeight() {
        return 36;
    }

    get bodyHeight() {
        return this.ganttData ? this.ganttData.rows.length * this.rowHeight : 0;
    }
}

export const x2ManyGanttField = {
    component: X2ManyGanttField,
    displayName: "Gantt Chart",
    supportedTypes: ["one2many", "many2many"],
    useSubView: true,
    extractProps({ attrs }) {
        return {
            dateStart:     attrs.date_start,
            dateEnd:       attrs.date_end,
            nameField:     attrs.name_field || "name",
            defaultScale:  attrs.default_scale || "week",
            tooltipFields: attrs.tooltip_fields
                ? attrs.tooltip_fields.split(",").map((s) => s.trim()).filter(Boolean)
                : [],
            barClickable:  attrs.bar_clickable === "1" || attrs.bar_clickable === "True",
        };
    },
};

registry.category("fields").add("x2many_gantt", x2ManyGanttField);
