import * as React from "react";
import {
  ROOT_ID,
  getCatalogState,
  setCatalogState,
  useHierarchyEntry,
  useValueEntry,
} from "./catalogDataContainer";
import { NewEntryForm } from "./NewEntryForm";
import { DragHandle } from "./DragHandle";
import { getInsertOrder, setInsertOrder } from "./dragUtils";
import {
  addEntryReducer,
  reorderReducer,
  updateValueEntryReducer,
} from "./catalogReducers";

const updateValueEntry = (catalogId, updateValueEntryAction) => {
  setCatalogState(
    catalogId,
    updateValueEntryReducer(getCatalogState(catalogId), updateValueEntryAction)
  );
};

const addEntry = (catalogId, addEntryAction) => {
  setCatalogState(
    catalogId,
    addEntryReducer(getCatalogState(catalogId), addEntryAction)
  );
};

const reorder = (catalogId, reorderAction) => {
  setCatalogState(
    catalogId,
    reorderReducer(getCatalogState(catalogId), reorderAction)
  );
};

const EditValue = ({ className, initialValue = "", onFinish }) => {
  const inputRef = React.useRef();
  const [localValue, setLocalValue] = React.useState(initialValue);
  const finishEditing = React.useCallback(() => {
    onFinish(localValue.trim() ? localValue : initialValue);
  }, [onFinish, localValue]);
  const onChange = React.useCallback(
    (event) => {
      setLocalValue(event.target.value);
    },
    [setLocalValue]
  );
  const onKeyPress = React.useCallback(
    (event) => {
      if (event.key === "Enter") {
        finishEditing();
      }
    },
    [finishEditing]
  );
  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);
  return /*#__PURE__*/ React.createElement("input", {
    "data-editable": true,
    ref: inputRef,
    className: className,
    onBlur: finishEditing,
    onChange: onChange,
    onKeyPress: onKeyPress,
    value: localValue,
  });
};

const EDIT_KEY = 0;
const EDIT_VALUE = 1;
export const CatalogEntry = ({
  catalogContext,
  colorIdx = 0,
  depth = 0,
  entryId,
  forceRemove,
  parentId,
}) => {
  const {
    catalogId,
    currentDragSource,
    currentDragTarget,
    isDragActive,
    removedEntries,
    setDragSource,
    setDragTarget,
    setIsDragActive,
    toggleRemoveEntry,
  } = catalogContext;
  const valueEntry = useValueEntry(catalogId, entryId);
  const hierarchyEntry = useHierarchyEntry(catalogId, entryId);
  const [isDragAllowed, setIsDragAllowed] = React.useState(false);
  const didUnmount = React.useRef(false);
  const [isEditing, setEditMode] = React.useState(false); // Local insert order is used for the drop indicator ( = placeholder).
  // Local value is updated into global ref by "pointer up" event

  const [localInsertOrder, setLocalInsertOrder] = React.useState(null);
  const isRemoved = removedEntries.has(entryId);
  const removedState = forceRemove ?? isRemoved;
  const [showDragHandle, setShowDragHandle] = React.useState(false);
  const [showNewEntryForm, setShowNewEntryForm] = React.useState(false);
  const [isExpanded, setIsExpanded] = React.useState(true);

  const onPointerDown = () => {
    setIsDragAllowed(true);
    setDragSource(entryId); // initialize pointer up event here to clear the
    // drag active state, it should be guaranteed that this
    // gets triggered

    window.addEventListener(
      "pointerup",
      () => {
        setIsDragActive(false);
        setIsDragAllowed(false);
      },
      {
        once: true,
      }
    );
  };

  const onPointerMove = () => {
    if (isDragAllowed) {
      setIsDragActive(true);
    }
  };

  const dragHandle =
    !isDragActive && showDragHandle
      ? /*#__PURE__*/ React.createElement(DragHandle, {
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
        })
      : null;
  React.useEffect(
    () => () => {
      didUnmount.current = true;
    },
    []
  );
  React.useEffect(() => {
    if (isEditing !== false && editfieldRef.current) {
      editfieldRef.current.focus();
    }
  }, [isEditing]);
  const editfieldRef = React.useRef(); // entries which belong to ROOT_ID's hierarchy are considered to be 'root entries'

  const isRoot = parentId === ROOT_ID;
  const listPointerEvents = {
    onPointerEnter: () => {
      if (isDragActive) {
        setDragTarget(entryId);
      } else {
        setShowDragHandle(true);
      }
    },
    onPointerLeave: () => {
      setShowDragHandle(false);

      if (isDragActive && currentDragTarget === entryId) {
        setDragTarget(null);
      }
    },
    onPointerUp: () => {
      if (!didUnmount.current) {
        setIsDragAllowed(false);
      }

      setInsertOrder(localInsertOrder);

      if (isDragActive) {
        // This has to be passed via argument. dragTarget from state is only updated
        // on next cycle (as state updates are asynchronous)
        reorder(catalogId, {
          targetId: entryId,
          sourceId: currentDragSource,
          insertOrder: getInsertOrder(),
        });
        setDragSource(null);
        setDragTarget(null);
      }

      if (!didUnmount.current) {
        setIsDragActive(false);
      }
    },
  };

  const entryClasses = () =>
    `catalog__entry${hierarchyEntry ? " catalog__entry--sublist" : ""}${
      colorIdx % 2 ? " catalog__entry--gray" : " catalog__entry--blue"
    }${
      isDragActive &&
      currentDragSource !== entryId &&
      currentDragTarget === entryId &&
      localInsertOrder === "before"
        ? " catalog__entry--hilite-before"
        : ""
    }${
      isDragActive &&
      currentDragSource !== entryId &&
      currentDragTarget === entryId &&
      localInsertOrder === "after"
        ? " catalog__entry--hilite-after"
        : ""
    }${removedState ? " catalog__entry--removed" : ""}${
      isDragActive && currentDragSource === entryId
        ? " catalog__entry--dragging"
        : ""
    }`;

  const insertUtilBefore =
    isDragActive &&
    localInsertOrder !== "before" &&
    /*#__PURE__*/ React.createElement("div", {
      onPointerEnter: () => setLocalInsertOrder("before"),
      className: "insert-order-util insert-order-util--before",
    });
  const insertUtilAfter =
    isDragActive &&
    localInsertOrder !== "after" &&
    /*#__PURE__*/ React.createElement("div", {
      onPointerEnter: () => setLocalInsertOrder("after"),
      className: "insert-order-util insert-order-util--after",
    });
  const removeButton =
    forceRemove === undefined && !isDragActive && showDragHandle
      ? /*#__PURE__*/ React.createElement(
          "span",
          {
            title: !isRemoved ? "Remove entry" : "Undo remove",
            className: "catalog__remove-entry",
            onClick: () => {
              toggleRemoveEntry(entryId, !isRemoved);
            },
          },
          !isRemoved ? "\u2715" : "\u238c"
        )
      : null;

  if (!hierarchyEntry) {
    return /*#__PURE__*/ React.createElement(
      "li",
      { ...listPointerEvents, key: entryId, className: entryClasses() },
      insertUtilBefore,
      insertUtilAfter,
      /*#__PURE__*/ React.createElement(
        "span",
        {
          onDoubleClick: () => {
            if (!removedState) {
              setEditMode(0);
            }
          },
          className: `catalog__entry__key${
            isRoot ? " catalog__entry__key--title" : ""
          }`,
          style: {
            paddingLeft: `${depth * 25}px`,
          },
        },
        dragHandle,
        isEditing === EDIT_KEY
          ? /*#__PURE__*/ React.createElement(EditValue, {
              onFinish: (newValue) => {
                updateValueEntry(catalogId, {
                  entryId,
                  newValue: [newValue, valueEntry[1]],
                });
                setEditMode(false);
              },
              className: "catalog__entry__key__content",
              initialValue: valueEntry[0],
            })
          : /*#__PURE__*/ React.createElement(
              React.Fragment,
              null,
              /*#__PURE__*/ React.createElement(
                "span",
                {
                  className: "catalog__entry__key__content",
                },
                valueEntry[0]
              ),
              removeButton
            )
      ),
      /*#__PURE__*/ React.createElement(
        "span",
        {
          className: "catalog__entry__value",
          onDoubleClick: () => {
            if (!removedState) {
              setEditMode(1);
            }
          },
        },
        isEditing === EDIT_VALUE
          ? /*#__PURE__*/ React.createElement(EditValue, {
              className: "catalog__entry__value__content",
              onFinish: (newValue) => {
                updateValueEntry(catalogId, {
                  entryId,
                  newValue: [valueEntry[0], newValue],
                });
                setEditMode(false);
              },
              initialValue: valueEntry[1],
            })
          : /*#__PURE__*/ React.createElement(
              "span",
              {
                className: "catalog__entry__value__content",
              },
              valueEntry[1]
            )
      )
    );
  } else {
    const insertButton =
      showNewEntryForm || (!isDragActive && showDragHandle)
        ? /*#__PURE__*/ React.createElement(
            "span",
            {
              title: "Add entry",
              className: `catalog__add-entry${
                showNewEntryForm ? " catalog__add-entry--active" : ""
              }`,
              onClick: () => setShowNewEntryForm(!showNewEntryForm),
            },
            "\u002b"
          )
        : null;
    const expandButton = /*#__PURE__*/ React.createElement(
      "span",
      {
        onClick: () => setIsExpanded(!isExpanded),
        className: "catalog__expand-button",
      },
      isExpanded ? "\u25bd" : "\u25b3"
    );
    const newEntryForm = showNewEntryForm
      ? /*#__PURE__*/ React.createElement(NewEntryForm, {
          indentation: depth,
          onAdd: (entryType, entryData) => {
            addEntry(catalogId, {
              hierarchyId: entryId,
              entryType,
              entryData,
            });
            setShowNewEntryForm(false);
          },
          onCancel: () => setShowNewEntryForm(false),
        })
      : null;
    return /*#__PURE__*/ React.createElement(
      React.Fragment,
      null,
      /*#__PURE__*/ React.createElement(
        "li",
        { ...listPointerEvents, className: entryClasses() },
        insertUtilBefore,
        insertUtilAfter,
        /*#__PURE__*/ React.createElement(
          "span",
          {
            style: {
              paddingLeft: `${depth * 25}px`,
            },
            className: "catalog__entry__key catalog__entry__key--title",
          },
          dragHandle,
          expandButton,
          isEditing === EDIT_KEY
            ? /*#__PURE__*/ React.createElement(EditValue, {
                className: "catalog__entry__value__content",
                onFinish: (newValue) => {
                  updateValueEntry(catalogId, {
                    entryId,
                    newValue: [newValue, valueEntry[1]],
                  });
                  setEditMode(false);
                },
                initialValue: valueEntry[0],
              })
            : /*#__PURE__*/ React.createElement(
                "span",
                {
                  onDoubleClick: () => setEditMode(EDIT_KEY),
                  className: "catalog__entry__key__content",
                },
                valueEntry[0]
              ),
          insertButton,
          removeButton
        ),
        newEntryForm
      ),
      isExpanded
        ? hierarchyEntry.map((childId) =>
            /*#__PURE__*/ React.createElement(CatalogEntry, {
              key: childId,
              catalogContext: catalogContext,
              colorIdx: colorIdx,
              depth: depth + 1,
              entryId: childId,
              forceRemove: removedState ? true : undefined,
              parentId: entryId,
            })
          )
        : null
    );
  }
};

