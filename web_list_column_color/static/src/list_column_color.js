import { ListRenderer } from "@web/views/list/list_renderer";
import { patch } from "@web/core/utils/patch";

patch(ListRenderer.prototype, {
    getColumnBgStyle(column) {
        const color = column.options && column.options.background_color;
        if (!color) return "";
        return `background-color: ${color} !important;`;
    },
});
