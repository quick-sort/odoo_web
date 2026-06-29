import {Component} from "@odoo/owl";
import {DropdownItem} from "@web/core/dropdown/dropdown_item";
import {registry} from "@web/core/registry";

const cogMenuRegistry = registry.category("cogMenu");

export class AddToSpreadsheet extends Component {
    static template = "spreadsheet_oca.AddToSpreadsheet";
    static components = {DropdownItem};
    static props = {};

    onAddToSpreadsheet() {
        this.env.bus.trigger("addListOnSpreadsheet");
    }
}

cogMenuRegistry.add(
    "spreadsheet-oca-list-menu",
    {
        Component: AddToSpreadsheet,
        groupNumber: 20,
        isDisplayed: ({config, isSmall}) => !isSmall && config.viewType === "list",
    },
    {sequence: 20}
);
