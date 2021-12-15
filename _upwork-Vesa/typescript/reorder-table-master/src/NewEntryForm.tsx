import * as React from "react";

export const NewEntryForm = ({
    onAdd,
    onCancel,
    indentation = 0,
}: {
    indentation?: number;
    onCancel?: () => void;
    onAdd: (
        entryType: "atomic" | "sublist",
        entryData: [string, string]
    ) => void;
}) => {
    const [entryType, setEntryType] = React.useState<"atomic" | "sublist">(
        "atomic"
    );
    const [key, setKey] = React.useState("");
    const [value, setValue] = React.useState("");

    return (
        <div
            style={{ paddingLeft: `${35 + indentation * 25}px` }}
            className="new-entry-form"
        >
            <div className="new-entry-form__type">
                <span className="new-entry-form__type__description">
                    Entry type
                </span>
                <span
                    onClick={() => setEntryType("atomic")}
                    className={`new-entry-form__type__option${
                        entryType === "atomic"
                            ? " new-entry-form__type__option--selected"
                            : ""
                    }`}
                >
                    atomic
                </span>
                <span
                    onClick={() => setEntryType("sublist")}
                    className={`new-entry-form__type__option${
                        entryType === "sublist"
                            ? " new-entry-form__type__option--selected"
                            : ""
                    }`}
                >
                    sublist
                </span>
            </div>
            <input
                onKeyPress={(event) => {
                    if (
                        entryType === "sublist" &&
                        event.key === "Enter" &&
                        key.length > 0
                    ) {
                        onAdd(entryType, [key, value]);
                    }
                }}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                className="new-entry-form__key"
                placeholder="key"
            />
            <input
                onKeyPress={(event) => {
                    if (
                        event.key === "Enter" &&
                        key.length > 0 &&
                        value.length > 0
                    ) {
                        onAdd(entryType, [key, value]);
                    }
                }}
                disabled={entryType === "sublist"}
                value={entryType === "atomic" ? value : ""}
                onChange={(event) => setValue(event.target.value)}
                className="new-entry-form__value"
                placeholder={
                    entryType === "atomic" ? "value" : "disabled for sublist"
                }
            />
            <div className="new-entry-form__buttons">
            <span
                className="new-entry-form__ok"
                onClick={() => onAdd(entryType, [key, value])}
            >
                Add
            </span>
            {onCancel ? (
                <span className="new-entry-form__cancel" onClick={onCancel}>
                    Cancel
                </span>
            ) : null}</div>
        </div>
    );
};
