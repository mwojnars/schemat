const ROOT_ID = 0;
const HIERARCHY_IDX = 0;
const VALUE_IDX = 1;
const catalogStateContainer = new Map();
const subscriberFuncs = new Map();
const getCatalogState = (catalogId) => catalogStateContainer.get(catalogId);
const setCatalogState = (catalogId, nextState) => {
  catalogStateContainer.set(catalogId, nextState);
  const subscribers = subscriberFuncs.get(catalogId);

  if (subscribers) {
    subscribers.forEach((subscriberFunc) => {
      subscriberFunc(nextState);
    });
  }
};

const subscribeToCatalogState = (catalogId, subscriberFunc) => {
  if (!subscriberFuncs.has(catalogId)) {
    subscriberFuncs.set(catalogId, new Set());
  }

  subscriberFuncs.get(catalogId).add(subscriberFunc); // returns unsubscribe function

  return () => {
    subscriberFuncs.get(catalogId).delete(subscriberFunc);

    if (subscriberFuncs.get(catalogId).size === 0) {
      // delete empty subscriber container
      subscriberFuncs.delete(catalogId);
    }
  };
};

const isValueEntry = (entry) => typeof entry[1] === "string";

const isSublistEntry = (entry) => !isValueEntry(entry); // Create flattened version of the list representation.
// Returns separate hierarchy and value maps

const reducerFunc = (acc, current, parentId, idRef) => {
  const id = idRef.current;
  idRef.current = idRef.current + 1;
  const [hierarchyAcc, valueAcc] = acc;

  if (isValueEntry(current)) {
    // current value is an atomic (string)
    valueAcc.set(id, current);
  } else if (isSublistEntry(current)) {
    // current value is a sublist
    hierarchyAcc.set(id, []); // Perhaps later on sublist can also have a description
    // ( = value field)

    valueAcc.set(id, [current[0], current[0]]);
    current[1].forEach((currentChild) =>
      reducerFunc(acc, currentChild, id, idRef)
    );
  } // add current id to parent's hierarchy items

  hierarchyAcc.get(parentId).push(id);
  return acc;
};

const flattenData = (data) => {
  const idRef = {
    current: ROOT_ID + 1,
  };
  const initAcc = [new Map(), new Map()];
  initAcc[0].set(ROOT_ID, []);
  return data.reduce(
    (acc, current) => reducerFunc(acc, current, ROOT_ID, idRef),
    initAcc
  );
};

let catalogIdCounter = 1;

const nextCatalogId = () => {
  const currentId = catalogIdCounter;
  catalogIdCounter = catalogIdCounter + 1;
  return currentId;
};

const useInitializeCatalogState = (initialData) => {
  const catalogIdRef = React.useRef(null);

  if (catalogIdRef.current !== null) {
    // the state has already been created,
    // only return the identifier to the corresponding
    // data container entry
    return catalogIdRef.current;
  } else {
    const catalogId = nextCatalogId();
    const catalogState = flattenData(initialData);
    catalogStateContainer.set(catalogId, catalogState);
    catalogIdRef.current = catalogId;
    return catalogIdRef.current;
  }
};

const useCatalogEntry = (catalogId, entryId, dataIdx) => {
  const firstTimeRef = React.useRef(true);
  const [counter, setCounter] = React.useState(0);
  const dataEntryRef = React.useRef(null);
  const unsubscribeFuncRef = React.useRef(null); // create a reference to state counter which is needed in the
  // subscriberFunc. Otherwise the reference to the counter
  // is obsoleted

  const counterRef = React.useRef();
  counterRef.current = counter;
  React.useEffect(
    () => () => {
      if (unsubscribeFuncRef.current) {
        unsubscribeFuncRef.current();
      }
    },
    []
  );

  if (firstTimeRef.current) {
    firstTimeRef.current = false;

    const subscriberFunc = (state) => {
      const nextValue = state[dataIdx].get(entryId);

      if (nextValue !== dataEntryRef.current) {
        dataEntryRef.current = nextValue;
        setCounter(counterRef.current + 1);
      }
    };

    unsubscribeFuncRef.current = subscribeToCatalogState(
      catalogId,
      subscriberFunc
    ); // assign initial value from state

    dataEntryRef.current = catalogStateContainer
      .get(catalogId)
      [dataIdx].get(entryId);
  }

  return dataEntryRef.current;
};

const useHierarchyEntry = (catalogId, entryId) =>
  useCatalogEntry(catalogId, entryId, HIERARCHY_IDX);
const useValueEntry = (catalogId, entryId) =>
  useCatalogEntry(catalogId, entryId, VALUE_IDX);

const NewEntryForm = ({ onAdd, onCancel, indentation = 0 }) => {
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

const DragHandle = ({ onPointerDown, onPointerMove }) =>
  /*#__PURE__*/ React.createElement(
    "span",
    {
      onPointerDown: onPointerDown,
      onPointerMove: onPointerMove,
      className: "drag-handle",
    },
    "\u22ee\u22ee"
  );

// keep track of the insert order, in other words
// this dictates should the dragged element be inserted
// before or after the target element
let insertOrder = null;
const setInsertOrder = (order) => {
  insertOrder = order;
};
const getInsertOrder = () => insertOrder;

const updateValueEntryReducer = (catalogState, { entryId, newValue }) => {
  const [hierarchy, valueEntries] = catalogState;
  const nextValueEntries = new Map(valueEntries);
  nextValueEntries.set(entryId, newValue);
  return [hierarchy, nextValueEntries];
};
// applies reordering action and updates the hierarchy (immutable action)
const reorderReducer = (catalogState, { targetId, sourceId, insertOrder }) => {
  if (sourceId === null) {
    return catalogState;
  }

  if (targetId === null) {
    return catalogState;
  }

  const [hierarchy] = catalogState;
  const sourceParent = Array.from(hierarchy.entries()).find(
    ([_parentId, children]) => children.includes(sourceId)
  )[0];
  const targetParent = Array.from(hierarchy.entries()).find(
    ([_parentId, children]) => children.includes(targetId)
  )[0];

  if (sourceId === targetId) {
    // do nothing if not really reordering anything
    return catalogState;
  } else if (sourceId === targetParent) {
    // cannot move inside itself
    return catalogState;
  } else if (sourceParent !== targetParent) {
    // only allow moves inside same hieararchial parenta
    return catalogState;
  }

  const nextHierarchy = new Map(hierarchy);
  const nextChildren = Array.from(nextHierarchy.get(targetParent));
  nextHierarchy.set(targetParent, nextChildren);
  const deleteIndex = nextChildren.indexOf(sourceId);
  let insertIndex = nextChildren.indexOf(targetId);

  if (insertOrder === "after") {
    insertIndex = insertIndex + 1;
  }

  if (deleteIndex < insertIndex) {
    insertIndex = insertIndex - 1;
  }

  nextChildren.splice(deleteIndex, 1);
  nextChildren.splice(insertIndex, 0, sourceId);
  return [nextHierarchy, catalogState[1]];
};
const addEntryReducer = (
  [hierarchy, entryValues],
  { hierarchyId: parentId, entryType, entryData }
) => {
  const nextHierarchy = new Map(hierarchy);
  const nextId = Array.from(entryValues.keys()).sort((a, b) => b - a)[0] + 1;
  const nextChildren = nextHierarchy.get(parentId).concat(nextId);
  const nextValues = new Map(entryValues);
  nextHierarchy.set(parentId, nextChildren);
  nextValues.set(nextId, entryData);

  if (entryType === "sublist") {
    nextHierarchy.set(nextId, []);
  }

  return [nextHierarchy, nextValues];
};

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
const CatalogEntry = ({
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

const EMPTY_LIST = [];
const getDiff = (
  [hierarchy, valueEntries],
  [otherHierarchy, otherValueEntries],
  removedEntries
) => {
  const hierarchyEntries = Array.from(otherHierarchy.entries());

  const resolvePath = (id) => {
    if (id === ROOT_ID) {
      return "/";
    } else {
      const parentId =
        hierarchyEntries.find(([_hierarchyEntryId, children]) =>
          children.includes(id)
        )?.[0] ?? null;
      let currentPath = valueEntries.get(id)?.[0] ?? null;

      if (currentPath === null) {
        currentPath = String(id);
      }

      return `${resolvePath(parentId)}${currentPath}/`;
    }
  };

  const hierarchyDiff = new Map();
  const valueEntryDiff = new Map();
  const allHierarchyEntries = Array.from(
    new Set(
      Array.from(hierarchy.keys()).concat(Array.from(otherHierarchy.keys()))
    ).values()
  );
  allHierarchyEntries.forEach((entryId) => {
    const children = hierarchy.get(entryId) ?? null;
    const otherChildren = otherHierarchy.get(entryId) ?? null;

    if (removedEntries.has(entryId)) {
      hierarchyDiff.set(resolvePath(entryId), EMPTY_LIST);
      return;
    }

    if (children && !otherChildren) {
      hierarchyDiff.set(resolvePath(entryId), null);
    } else if (!children && otherChildren) {
      hierarchyDiff.set(
        resolvePath(entryId),
        otherChildren.map((childId) => resolvePath(childId))
      );
    } else if (
      (otherChildren && otherChildren.length !== children.length) ||
      children.some(
        (childId, idx) => childId !== otherHierarchy.get(entryId)[idx]
      )
    ) {
      // children have changed
      hierarchyDiff.set(
        resolvePath(entryId),
        otherChildren.map((childId) => resolvePath(childId))
      );
    }
  });
  const allValueEntries = new Set(
    Array.from(valueEntries.keys()).concat(Array.from(otherValueEntries.keys()))
  );
  allValueEntries.forEach((entryId) => {
    // handle value entries, exclude ROOT_ID
    if (entryId !== ROOT_ID) {
      const valueEntry = valueEntries.get(entryId) ?? null;
      const otherValueEntry = otherValueEntries.get(entryId) ?? null;

      if (removedEntries.has(entryId)) {
        valueEntryDiff.set(resolvePath(entryId), null);
      } else if (
        (!valueEntry && otherValueEntry) ||
        valueEntry[0] !== otherValueEntry[0] ||
        valueEntry[1] !== otherValueEntry[1]
      ) {
        // key - value pair has changed
        valueEntryDiff.set(resolvePath(entryId), otherValueEntry);
      } else if (valueEntry && !otherValueEntry) {
        valueEntryDiff.set(resolvePath(entryId), null);
      }
    }
  });
  const mergedDiff = new Map();
  Array.from(hierarchyDiff.entries()).forEach(([hierarchyId, newChildren]) => {
    mergedDiff.set(hierarchyId, {
      hierarchyDiff: newChildren,
    });
  });
  Array.from(valueEntryDiff.entries()).forEach(([valueEntryId, newValue]) => {
    if (!mergedDiff.has(valueEntryId)) {
      mergedDiff.set(valueEntryId, {
        valueDiff: newValue,
      });
    } else {
      const currentDiffEntry = mergedDiff.get(valueEntryId);
      currentDiffEntry.valueDiff = newValue;
    }
  });
  return Object.fromEntries(mergedDiff.entries());
};

const getPropertyText = (properties) => {
  if (properties.length > 4) {
    return `${properties
      .slice(0, 3)
      .map((val) => `"${val}"`)
      .join(", ")}, and ${properties.length - 3} others`;
  } else {
    return properties.join(", ");
  }
};

const DRAG_OFFSET = 5;

const CatalogDragCompanion = ({ catalogId, entryId }) => {
  const catalogState = getCatalogState(catalogId);
  const [entryValue] = catalogState[VALUE_IDX].get(entryId);
  const hasHierarchy =
    catalogState[HIERARCHY_IDX].has(entryId) &&
    catalogState[HIERARCHY_IDX].get(entryId).length > 0;
  const [position, setPosition] = React.useState({
    x: null,
    y: null,
  });
  React.useEffect(() => {
    const updateCompanionPosition = (event) => {
      setPosition({
        x: event.pageX,
        y: event.pageY,
      });
    };

    window.addEventListener("pointermove", updateCompanionPosition);
    return () => {
      window.removeEventListener("pointermove", updateCompanionPosition);
    };
  }, [setPosition]);
  return position.x !== null && position.y !== null
    ? /*#__PURE__*/ React.createElement(
        "li",
        {
          style: {
            transform: `translate(${position.x + DRAG_OFFSET}px, ${
              position.y + DRAG_OFFSET
            }px)`,
          },
          className: "catalog__drag-companion",
        },
        `Dragging "${entryValue}"`,
        hasHierarchy
          ? ` (with ${getPropertyText(
              catalogState[HIERARCHY_IDX].get(entryId).map(
                (idx) => catalogState[VALUE_IDX].get(idx)[0]
              )
            )})`
          : null
      )
    : null;
};

const CatalogButtons = ({
  catalogId,
  catalogInitialState,
  removedEntries,
  undeleteAll,
}) => {
  const [showNewEntry, setShowNewEntry] = React.useState(false);
  const onSubmitCb = React.useCallback(() => {
    const catalogState = getCatalogState(catalogId);
    console.log(getDiff(catalogInitialState, catalogState, removedEntries));
  }, [catalogId, removedEntries]);
  return /*#__PURE__*/ React.createElement(
    React.Fragment,
    null,
    showNewEntry
      ? /*#__PURE__*/ React.createElement(NewEntryForm, {
          onAdd: (entryType, entryData) => {
            setCatalogState(
              catalogId,
              addEntryReducer(getCatalogState(catalogId), {
                hierarchyId: ROOT_ID,
                entryType,
                entryData,
              })
            );
            setShowNewEntry(false);
          },
          onCancel: () => setShowNewEntry(false),
        })
      : null,
    /*#__PURE__*/ React.createElement(
      "div",
      {
        className: "catalog-buttons",
      },
      /*#__PURE__*/ React.createElement(
        "button",
        {
          className: "catalog-buttons__submit",
          onClick: onSubmitCb,
        },
        "Submit"
      ),
      /*#__PURE__*/ React.createElement(
        "button",
        {
          className: "catalog-buttons__reset",
          onClick: () => {
            setCatalogState(catalogId, catalogInitialState);
            undeleteAll();
          },
        },
        "Reset"
      ),
      /*#__PURE__*/ React.createElement(
        "button",
        {
          onClick: () => setShowNewEntry(!showNewEntry),
        },
        "New entry"
      )
    )
  );
};

const Catalog = ({ data }) => {
  const didUnmount = React.useRef(false);
  const firstTimeRef = React.useRef(true); // do not expose internal outside this component without capsulation!

  const [isDragActive, internal__setIsDragActive] = React.useState(false);
  const catalogId = useInitializeCatalogState(data);
  const catalogInitialStateRef = React.useRef(
    firstTimeRef ? getCatalogState(catalogId) : null
  );
  const [currentDragTarget, setDragTarget] = React.useState(null);
  const [currentDragSource, setDragSource] = React.useState(null);
  const [removedEntries, setRemovedEntries] = React.useState(new Set());
  const toggleRemoveEntry = React.useCallback(
    (entryId, removedState) => {
      const rm = new Set(removedEntries);

      if (removedState === true) {
        rm.add(entryId);
      } else if (removedState === false) {
        rm.delete(entryId);
      } else if (rm.has(entryId)) {
        rm.delete(entryId);
      } else {
        rm.add(entryId);
      }

      setRemovedEntries(rm);
    },
    [removedEntries, setRemovedEntries]
  );
  const setIsDragActive = React.useCallback(
    (newValue) => {
      if (!didUnmount.current) {
        // check that this component still exists first!
        internal__setIsDragActive(newValue);
      }
    },
    [internal__setIsDragActive]
  ); // set didUnmount when unmounting

  React.useEffect(
    () => () => {
      didUnmount.current = true;
    },
    []
  );
  firstTimeRef.current = false;
  const rootEntries = useHierarchyEntry(catalogId, ROOT_ID);
  const catalogContext = Object.freeze({
    catalogId,
    currentDragSource,
    currentDragTarget,
    isDragActive,
    removedEntries,
    setDragSource,
    setDragTarget,
    setIsDragActive,
    toggleRemoveEntry,
  });
  return /*#__PURE__*/ React.createElement(
    "div",
    {
      className: "catalog-container",
    },
    /*#__PURE__*/ React.createElement(
      "ul",
      {
        className: "catalog",
      },
      rootEntries.map((entryId, idx) =>
        /*#__PURE__*/ React.createElement(CatalogEntry, {
          key: entryId,
          catalogContext: catalogContext,
          colorIdx: idx,
          entryId: entryId,
          parentId: ROOT_ID,
        })
      ),
      isDragActive && currentDragSource !== null
        ? /*#__PURE__*/ React.createElement(CatalogDragCompanion, {
            catalogId: catalogId,
            entryId: currentDragSource,
          })
        : null
    ),
    /*#__PURE__*/ React.createElement(CatalogButtons, {
      catalogId: catalogId,
      catalogInitialState: catalogInitialStateRef.current,
      removedEntries: removedEntries,
      undeleteAll: () => setRemovedEntries(new Set()),
    })
  );
};
