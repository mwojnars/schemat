import * as ReactDOM from "react-dom";
import { Catalog } from "./Catalog";
import { type DataEntry } from "./catalogDataContainer";

const body = document.body;
const appContainer = document.createElement("div");

body.appendChild(appContainer);

const testData: DataEntry[] = [
    ["name", "Category"],
    ["info", "Category of items that represent categories"],
    ["class_name", "hyperweb.core.Category"],
    [
        "endpoints",
        [
            [
                "view",
                "context $item from base import %page_category page_category item",
            ],
        ],
    ],
    [
        "fields",
        [
            ["name", "STRING * human-readable title of the category"],
            ["info", "TEXT"],
            ["startup_site", "GENERIC"],
        ],
    ],
    ["startup_site", "[10, 1]"],
];

const testData2: DataEntry[] = [
    [
        "item",
        [
            ["subitem", "value"],
            [
                "subitem 2",
                [
                    ["sub-subitem", [["sub-sub-subitem", "an so on.."]]],
                    ["sub-subitem 2", "other value"],
                ],
            ],
        ],
    ],
    ["item 2", "foo"],
    ["item 3", "bar"],
];

const wrapperStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px",
};

ReactDOM.render(
    <div style={wrapperStyle}>
        <Catalog data={testData} />
        <Catalog data={testData2} />
    </div>,
    appContainer
);
