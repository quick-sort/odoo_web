/** @odoo-module **/

import { Component, onWillRender, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardFieldProps } from "@web/views/fields/standard_field_props";
import { FormViewDialog } from "@web/views/view_dialogs/form_view_dialog";

const { DateTime } = luxon;

// FormViewDialog's ToOne/ToMany button templates render an unconditional Save
// (the isInEdition guard is dropped during template inheritance), so readonly /
// preventEdit cannot hide it. Swap in an empty button template so only the
// dialog footer's Close button remains.
class ReadonlyFormViewDialog extends FormViewDialog {
    setup() {
        super.setup();
        this.viewProps.buttonTemplate = "web_widget_x2many_gantt.EmptyDialogButtons";
    }
}

// Odoo brand colors for gantt bars
const BAR_COLORS = [
    "#875A7B", "#3498DB", "#00A09D", "#E95454", "#F0AD4E",
    "#27AE60", "#9B59B6", "#1ABC9C", "#E67E22", "#2980B9",
];

const SCALE_CONFIG = {
    day:   { pxPerDay: 40,  minor: "day",   major: "month" },
    week:  { pxPerDay: 20,  minor: "week",  major: "month" },
    month: { pxPerDay: 1,   minor: "month", major: "year"  },
    year:  { pxPerDay: 0.2, minor: "year",  major: "year"  },
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
        colorField:    { type: String, optional: true },
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
        const { colorMap, legend } = this._buildColorMap(records);
        const rows = this._buildRows(records, minDate, cfg.pxPerDay, colorMap);

        // Today marker position
        const now = DateTime.now();
        const todayPx = (now >= minDate && now <= maxDate)
            ? now.diff(minDate, "days").days * cfg.pxPerDay
            : null;

        this.ganttData = { scale, totalPx, majorCells, minorCells, rows, todayPx, legend };
    }

    /**
     * Deterministic, stable index derived from a string. Used so that the same
     * color-field value always maps to the same palette slot, regardless of
     * which records happen to be present or in what order.
     */
    _hashIndex(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
        }
        return Math.abs(h);
    }

    /**
     * Extract the color key, human label and a stable palette index for a
     * record's color field. Returns null when no color field is configured.
     *
     * The index is derived deterministically from the value itself (not from
     * first-seen order), so the same value renders with the same color across
     * different gantt charts even when their value domains differ. For
     * selection/boolean fields we use the position in the field definition so
     * distinct values stay maximally spread; for everything else we hash the key.
     */
    _colorKey(record) {
        const fieldName = this.props.colorField;
        if (!fieldName) return null;

        const raw = record.data[fieldName];
        const fieldDef = record.fields[fieldName];

        if (raw === false || raw === undefined || raw === null) {
            return { key: "__empty__", label: "—", index: this._hashIndex("__empty__") };
        }
        if (fieldDef?.type === "many2one") {
            // raw is [id, display_name]
            const id = Array.isArray(raw) ? raw[0] : raw;
            const label = Array.isArray(raw) ? raw[1] : String(raw);
            return { key: `m2o_${id}`, label, index: this._hashIndex(`m2o_${id}`) };
        }
        if (fieldDef?.type === "selection") {
            const selection = fieldDef.selection || [];
            const pos = selection.findIndex(([v]) => v === raw);
            const choice = pos >= 0 ? selection[pos] : null;
            return {
                key: String(raw),
                label: choice ? choice[1] : String(raw),
                index: pos >= 0 ? pos : this._hashIndex(String(raw)),
            };
        }
        if (fieldDef?.type === "boolean") {
            return { key: String(raw), label: raw ? "Yes" : "No", index: raw ? 1 : 0 };
        }
        return { key: String(raw), label: String(raw), index: this._hashIndex(String(raw)) };
    }

    /**
     * Map a sequential, dense index (0, 1, 2, …) to a color by spreading it
     * around the HSL hue wheel with the golden angle. The golden angle keeps
     * even adjacent indices far apart on the wheel, so a handful of values get
     * clearly distinct colors. NOTE: this only disperses well for *sequential*
     * indices — feeding it arbitrary hashes does not guarantee separation.
     * Saturation/lightness are fixed for consistent contrast with bar labels.
     */
    _hueColor(index) {
        const hue = Math.round((index * 137.508) % 360);
        return `hsl(${hue}, 60%, 45%)`;
    }

    /**
     * Build a map from color-field value → color, plus legend entries.
     *
     * For selection/boolean fields we color by the value's position in the
     * field definition, so a given value gets the same color in every gantt
     * chart regardless of which other values are present.
     *
     * For open-domain fields (char, many2one) there is no global definition to
     * anchor to, so hashing values to hues can make distinct values collide.
     * Instead we collect the distinct values actually present, sort them
     * deterministically, and spread them evenly around the hue wheel. This
     * guarantees the values shown in a single chart are visually distinct, and
     * keeps colors stable across charts that show the same set of values
     * (order no longer matters — only the set does).
     */
    _buildColorMap(records) {
        const colorMap = new Map();
        const legend = [];
        const fieldName = this.props.colorField;
        if (!fieldName) {
            return { colorMap, legend };
        }

        const fieldDef = records[0]?.fields[fieldName];
        const useDefinitionOrder =
            fieldDef && (fieldDef.type === "selection" || fieldDef.type === "boolean");

        // Collect distinct color keys (keep first-seen label).
        const distinct = new Map();
        for (const record of records) {
            const ck = this._colorKey(record);
            if (!ck || distinct.has(ck.key)) continue;
            distinct.set(ck.key, ck);
        }

        let ordered;
        if (useDefinitionOrder) {
            // Color directly from the definition index → fully chart-independent.
            ordered = [...distinct.values()].map((ck) => ({ ck, hueIndex: ck.index }));
        } else {
            // Sort the present values, then assign dense ranks for even spread.
            ordered = [...distinct.values()]
                .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
                .map((ck, rank) => ({ ck, hueIndex: rank }));
        }

        for (const { ck, hueIndex } of ordered) {
            const color = this._hueColor(hueIndex);
            colorMap.set(ck.key, color);
            legend.push({ key: ck.key, label: ck.label, color });
        }
        return { colorMap, legend };
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
        } else if (scale === "month") {
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
        } else {
            // scale === "year": one cell per year, no major row
            let cur = minDate.startOf("year");
            while (cur < maxDate) {
                const next = cur.plus({ years: 1 });
                const clampStart = DateTime.max(cur, minDate);
                const clampEnd   = DateTime.min(next, maxDate);
                const days = clampEnd.diff(clampStart, "days").days;
                minorCells.push({
                    key: cur.toISO(),
                    label: cur.toFormat("yyyy"),
                    width: days * pxPerDay,
                });
                cur = next;
            }
        }

        return { majorCells, minorCells };
    }

    _buildRows(records, minDate, pxPerDay, colorMap) {
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
                let color = BAR_COLORS[index % BAR_COLORS.length];
                if (this.props.colorField) {
                    const ck = this._colorKey(record);
                    color = (ck && colorMap.get(ck.key)) || color;
                }
                bar = {
                    left:    Math.max(0, leftDays * pxPerDay),
                    width:   Math.max(4, widthDays * pxPerDay),
                    color,
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
        this.dialog.add(ReadonlyFormViewDialog, {
            resModel: this.list.resModel,
            resId: row.record.resId,
            title: row.name,
            preventCreate: true,
            preventEdit: true,
            readonly: true,
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
            colorField:    attrs.color_field || "",
            defaultScale:  attrs.default_scale || "week",
            tooltipFields: attrs.tooltip_fields
                ? attrs.tooltip_fields.split(",").map((s) => s.trim()).filter(Boolean)
                : [],
            barClickable:  attrs.bar_clickable === "1" || attrs.bar_clickable === "True",
        };
    },
};

registry.category("fields").add("x2many_gantt", x2ManyGanttField);
