import * as React from "react";
export const NewEntryForm = ({ onAdd, onCancel, indentation = 0 }) => {
  const [entryType, setEntryType] = React.useState("atomic");
  const [key, setKey] = React.useState("");
  const [value, setValue] = React.useState("");
  return /*#__PURE__*/ React.createElement(
    "div",
    {
      style: {
        paddingLeft: `${35 + indentation * 25}px`,
      },
      className: "new-entry-form",
    },
    /*#__PURE__*/ React.createElement(
      "div",
      {
        className: "new-entry-form__type",
      },
      /*#__PURE__*/ React.createElement(
        "span",
        {
          className: "new-entry-form__type__description",
        },
        "Entry type"
      ),
      /*#__PURE__*/ React.createElement(
        "span",
        {
          onClick: () => setEntryType("atomic"),
          className: `new-entry-form__type__option${
            entryType === "atomic"
              ? " new-entry-form__type__option--selected"
              : ""
          }`,
        },
        "atomic"
      ),
      /*#__PURE__*/ React.createElement(
        "span",
        {
          onClick: () => setEntryType("sublist"),
          className: `new-entry-form__type__option${
            entryType === "sublist"
              ? " new-entry-form__type__option--selected"
              : ""
          }`,
        },
        "sublist"
      )
    ),
    /*#__PURE__*/ React.createElement("input", {
      onKeyPress: (event) => {
        if (
          entryType === "sublist" &&
          event.key === "Enter" &&
          key.length > 0
        ) {
          onAdd(entryType, [key, value]);
        }
      },
      value: key,
      onChange: (event) => setKey(event.target.value),
      className: "new-entry-form__key",
      placeholder: "key",
    }),
    /*#__PURE__*/ React.createElement("input", {
      onKeyPress: (event) => {
        if (event.key === "Enter" && key.length > 0 && value.length > 0) {
          onAdd(entryType, [key, value]);
        }
      },
      disabled: entryType === "sublist",
      value: entryType === "atomic" ? value : "",
      onChange: (event) => setValue(event.target.value),
      className: "new-entry-form__value",
      placeholder: entryType === "atomic" ? "value" : "disabled for sublist",
    }),
    /*#__PURE__*/ React.createElement(
      "div",
      {
        className: "new-entry-form__buttons",
      },
      /*#__PURE__*/ React.createElement(
        "span",
        {
          className: "new-entry-form__ok",
          onClick: () => onAdd(entryType, [key, value]),
        },
        "Add"
      ),
      onCancel
        ? /*#__PURE__*/ React.createElement(
            "span",
            {
              className: "new-entry-form__cancel",
              onClick: onCancel,
            },
            "Cancel"
          )
        : null
    )
  );
};

