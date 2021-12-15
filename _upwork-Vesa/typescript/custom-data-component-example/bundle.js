(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __markAsModule = (target) =>
    __defProp(target, "__esModule", { value: true });
  var __commonJS = (cb, mod) =>
    function __require() {
      return (
        mod ||
          (0, cb[Object.keys(cb)[0]])((mod = { exports: {} }).exports, mod),
        mod.exports
      );
    };
  var __reExport = (target, module, desc) => {
    if (
      (module && typeof module === "object") ||
      typeof module === "function"
    ) {
      for (let key of __getOwnPropNames(module))
        if (!__hasOwnProp.call(target, key) && key !== "default")
          __defProp(target, key, {
            get: () => module[key],
            enumerable:
              !(desc = __getOwnPropDesc(module, key)) || desc.enumerable,
          });
    }
    return target;
  };
  var __toModule = (module) => {
    return __reExport(
      __markAsModule(
        __defProp(
          module != null ? __create(__getProtoOf(module)) : {},
          "default",
          module && module.__esModule && "default" in module
            ? { get: () => module.default, enumerable: true }
            : { value: module, enumerable: true }
        )
      ),
      module
    );
  };

  // globals:react-dom
  var require_react_dom = __commonJS({
    "globals:react-dom"(exports, module) {
      module.exports = ReactDOM;
    },
  });

  // globals:react
  var require_react = __commonJS({
    "globals:react"(exports, module) {
      module.exports = React;
    },
  });

  // src/index.tsx
  var ReactDOM2 = __toModule(require_react_dom());

  // src/Catalog.tsx
  var React5 = __toModule(require_react());

  // src/CatalogEntry.tsx
  var React4 = __toModule(require_react());

  // src/catalogDataContainer.ts
  var React2 = __toModule(require_react());
  var ROOT_ID = 0;
  var HIERARCHY_IDX = 0;
  var VALUE_IDX = 1;
  var catalogStateContainer = /* @__PURE__ */ new Map();
  var subscriberFuncs = /* @__PURE__ */ new Map();
  var getCatalogState = (catalogId) => catalogStateContainer.get(catalogId);
  var setCatalogState = (catalogId, nextState) => {
    catalogStateContainer.set(catalogId, nextState);
    const subscribers = subscriberFuncs.get(catalogId);
    if (subscribers) {
      subscribers.forEach((subscriberFunc) => {
        subscriberFunc(nextState);
      });
    }
  };
  var subscribeToCatalogState = (catalogId, subscriberFunc) => {
    if (!subscriberFuncs.has(catalogId)) {
      subscriberFuncs.set(catalogId, /* @__PURE__ */ new Set());
    }
    subscriberFuncs.get(catalogId).add(subscriberFunc);
    return () => {
      subscriberFuncs.get(catalogId).delete(subscriberFunc);
      if (subscriberFuncs.get(catalogId).size === 0) {
        subscriberFuncs.delete(catalogId);
      }
    };
  };
  var isValueEntry = (entry) => typeof entry[1] === "string";
  var isSublistEntry = (entry) => !isValueEntry(entry);
  var reducerFunc = (acc, current, parentId, idRef) => {
    const id = idRef.current;
    idRef.current = idRef.current + 1;
    const [hierarchyAcc, valueAcc] = acc;
    if (isValueEntry(current)) {
      valueAcc.set(id, current);
    } else if (isSublistEntry(current)) {
      hierarchyAcc.set(id, []);
      valueAcc.set(id, [current[0], current[0]]);
      current[1].forEach((currentChild) =>
        reducerFunc(acc, currentChild, id, idRef)
      );
    }
    hierarchyAcc.get(parentId).push(id);
    return acc;
  };
  var flattenData = (data) => {
    const idRef = { current: ROOT_ID + 1 };
    const initAcc = [/* @__PURE__ */ new Map(), /* @__PURE__ */ new Map()];
    initAcc[0].set(ROOT_ID, []);
    return data.reduce(
      (acc, current) => reducerFunc(acc, current, ROOT_ID, idRef),
      initAcc
    );
  };
  var catalogIdCounter = 1;
  var nextCatalogId = () => {
    const currentId = catalogIdCounter;
    catalogIdCounter = catalogIdCounter + 1;
    return currentId;
  };
  var useInitializeCatalogState = (initialData) => {
    const catalogIdRef = React2.useRef(null);
    if (catalogIdRef.current !== null) {
      return catalogIdRef.current;
    } else {
      const catalogId = nextCatalogId();
      const catalogState = flattenData(initialData);
      catalogStateContainer.set(catalogId, catalogState);
      catalogIdRef.current = catalogId;
      return catalogIdRef.current;
    }
  };
  var useCatalogEntry = (catalogId, entryId, dataIdx) => {
    const firstTimeRef = React2.useRef(true);
    const [counter, setCounter] = React2.useState(0);
    const dataEntryRef = React2.useRef(null);
    const unsubscribeFuncRef = React2.useRef(null);
    const counterRef = React2.useRef();
    counterRef.current = counter;
    React2.useEffect(
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
      );
      dataEntryRef.current = catalogStateContainer
        .get(catalogId)
        [dataIdx].get(entryId);
    }
    return dataEntryRef.current;
  };
  var useHierarchyEntry = (catalogId, entryId) =>
    useCatalogEntry(catalogId, entryId, HIERARCHY_IDX);
  var useValueEntry = (catalogId, entryId) =>
    useCatalogEntry(catalogId, entryId, VALUE_IDX);

  // src/NewEntryForm.tsx
  var React3 = __toModule(require_react());
  var NewEntryForm = ({ onAdd, onCancel, indentation = 0 }) => {
    const [entryType, setEntryType] = React3.useState("atomic");
    const [key, setKey] = React3.useState("");
    const [value, setValue] = React3.useState("");
    return /* @__PURE__ */ React3.createElement(
      "div",
      {
        style: { paddingLeft: `${35 + indentation * 25}px` },
        className: "new-entry-form",
      },
      /* @__PURE__ */ React3.createElement(
        "div",
        {
          className: "new-entry-form__type",
        },
        /* @__PURE__ */ React3.createElement(
          "span",
          {
            className: "new-entry-form__type__description",
          },
          "Entry type"
        ),
        /* @__PURE__ */ React3.createElement(
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
        /* @__PURE__ */ React3.createElement(
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
      /* @__PURE__ */ React3.createElement("input", {
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
      /* @__PURE__ */ React3.createElement("input", {
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
      /* @__PURE__ */ React3.createElement(
        "div",
        {
          className: "new-entry-form__buttons",
        },
        /* @__PURE__ */ React3.createElement(
          "span",
          {
            className: "new-entry-form__ok",
            onClick: () => onAdd(entryType, [key, value]),
          },
          "Add"
        ),
        onCancel
          ? /* @__PURE__ */ React3.createElement(
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

  // src/DragHandle.tsx
  var DragHandle = ({ onPointerDown, onPointerMove }) =>
    /* @__PURE__ */ React.createElement(
      "span",
      {
        onPointerDown,
        onPointerMove,
        className: "drag-handle",
      },
      "\u22EE\u22EE"
    );

  // src/dragUtils.ts
  var insertOrder = null;
  var setInsertOrder = (order) => {
    insertOrder = order;
  };
  var getInsertOrder = () => insertOrder;

  // src/catalogReducers.ts
  var updateValueEntryReducer = (catalogState, { entryId, newValue }) => {
    const [hierarchy, valueEntries] = catalogState;
    const nextValueEntries = new Map(valueEntries);
    nextValueEntries.set(entryId, newValue);
    return [hierarchy, nextValueEntries];
  };
  var reorderReducer = (
    catalogState,
    { targetId, sourceId, insertOrder: insertOrder2 }
  ) => {
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
      return catalogState;
    } else if (sourceId === targetParent) {
      return catalogState;
    } else if (sourceParent !== targetParent) {
      return catalogState;
    }
    const nextHierarchy = new Map(hierarchy);
    const nextChildren = Array.from(nextHierarchy.get(targetParent));
    nextHierarchy.set(targetParent, nextChildren);
    const deleteIndex = nextChildren.indexOf(sourceId);
    let insertIndex = nextChildren.indexOf(targetId);
    if (insertOrder2 === "after") {
      insertIndex = insertIndex + 1;
    }
    if (deleteIndex < insertIndex) {
      insertIndex = insertIndex - 1;
    }
    nextChildren.splice(deleteIndex, 1);
    nextChildren.splice(insertIndex, 0, sourceId);
    return [nextHierarchy, catalogState[1]];
  };
  var addEntryReducer = (
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

  // src/CatalogEntry.tsx
  var updateValueEntry = (catalogId, updateValueEntryAction) => {
    setCatalogState(
      catalogId,
      updateValueEntryReducer(
        getCatalogState(catalogId),
        updateValueEntryAction
      )
    );
  };
  var addEntry = (catalogId, addEntryAction) => {
    setCatalogState(
      catalogId,
      addEntryReducer(getCatalogState(catalogId), addEntryAction)
    );
  };
  var reorder = (catalogId, reorderAction) => {
    setCatalogState(
      catalogId,
      reorderReducer(getCatalogState(catalogId), reorderAction)
    );
  };
  var EditValue = ({ className, initialValue = "", onFinish }) => {
    const inputRef = React4.useRef();
    const [localValue, setLocalValue] = React4.useState(initialValue);
    const finishEditing = React4.useCallback(() => {
      onFinish(localValue.trim() ? localValue : initialValue);
    }, [onFinish, localValue]);
    const onChange = React4.useCallback(
      (event) => {
        setLocalValue(event.target.value);
      },
      [setLocalValue]
    );
    const onKeyPress = React4.useCallback(
      (event) => {
        if (event.key === "Enter") {
          finishEditing();
        }
      },
      [finishEditing]
    );
    React4.useEffect(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, []);
    return /* @__PURE__ */ React4.createElement("input", {
      "data-editable": true,
      ref: inputRef,
      className,
      onBlur: finishEditing,
      onChange,
      onKeyPress,
      value: localValue,
    });
  };
  var EDIT_KEY = 0;
  var EDIT_VALUE = 1;
  var CatalogEntry = ({
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
    const [isDragAllowed, setIsDragAllowed] = React4.useState(false);
    const didUnmount = React4.useRef(false);
    const [isEditing, setEditMode] = React4.useState(false);
    const [localInsertOrder, setLocalInsertOrder] = React4.useState(null);
    const isRemoved = removedEntries.has(entryId);
    const removedState = forceRemove ?? isRemoved;
    const [showDragHandle, setShowDragHandle] = React4.useState(false);
    const [showNewEntryForm, setShowNewEntryForm] = React4.useState(false);
    const [isExpanded, setIsExpanded] = React4.useState(true);
    const onPointerDown = () => {
      setIsDragAllowed(true);
      setDragSource(entryId);
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
        ? /* @__PURE__ */ React4.createElement(DragHandle, {
            onPointerDown,
            onPointerMove,
          })
        : null;
    React4.useEffect(
      () => () => {
        didUnmount.current = true;
      },
      []
    );
    React4.useEffect(() => {
      if (isEditing !== false && editfieldRef.current) {
        editfieldRef.current.focus();
      }
    }, [isEditing]);
    const editfieldRef = React4.useRef();
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
      /* @__PURE__ */ React4.createElement("div", {
        onPointerEnter: () => setLocalInsertOrder("before"),
        className: "insert-order-util insert-order-util--before",
      });
    const insertUtilAfter =
      isDragActive &&
      localInsertOrder !== "after" &&
      /* @__PURE__ */ React4.createElement("div", {
        onPointerEnter: () => setLocalInsertOrder("after"),
        className: "insert-order-util insert-order-util--after",
      });
    const removeButton =
      forceRemove === void 0 && !isDragActive && showDragHandle
        ? /* @__PURE__ */ React4.createElement(
            "span",
            {
              title: !isRemoved ? "Remove entry" : "Undo remove",
              className: "catalog__remove-entry",
              onClick: () => {
                toggleRemoveEntry(entryId, !isRemoved);
              },
            },
            !isRemoved ? "\u2715" : "\u238C"
          )
        : null;
    if (!hierarchyEntry) {
      return /* @__PURE__ */ React4.createElement(
        "li",
        {
          ...listPointerEvents,
          key: entryId,
          className: entryClasses(),
        },
        insertUtilBefore,
        insertUtilAfter,
        /* @__PURE__ */ React4.createElement(
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
            style: { paddingLeft: `${depth * 25}px` },
          },
          dragHandle,
          isEditing === EDIT_KEY
            ? /* @__PURE__ */ React4.createElement(EditValue, {
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
            : /* @__PURE__ */ React4.createElement(
                React4.Fragment,
                null,
                /* @__PURE__ */ React4.createElement(
                  "span",
                  {
                    className: "catalog__entry__key__content",
                  },
                  valueEntry[0]
                ),
                removeButton
              )
        ),
        /* @__PURE__ */ React4.createElement(
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
            ? /* @__PURE__ */ React4.createElement(EditValue, {
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
            : /* @__PURE__ */ React4.createElement(
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
          ? /* @__PURE__ */ React4.createElement(
              "span",
              {
                title: "Add entry",
                className: `catalog__add-entry${
                  showNewEntryForm ? " catalog__add-entry--active" : ""
                }`,
                onClick: () => setShowNewEntryForm(!showNewEntryForm),
              },
              "+"
            )
          : null;
      const expandButton = /* @__PURE__ */ React4.createElement(
        "span",
        {
          onClick: () => setIsExpanded(!isExpanded),
          className: "catalog__expand-button",
        },
        isExpanded ? "\u25BD" : "\u25B3"
      );
      const newEntryForm = showNewEntryForm
        ? /* @__PURE__ */ React4.createElement(NewEntryForm, {
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
      return /* @__PURE__ */ React4.createElement(
        React4.Fragment,
        null,
        /* @__PURE__ */ React4.createElement(
          "li",
          {
            ...listPointerEvents,
            className: entryClasses(),
          },
          insertUtilBefore,
          insertUtilAfter,
          /* @__PURE__ */ React4.createElement(
            "span",
            {
              style: { paddingLeft: `${depth * 25}px` },
              className: "catalog__entry__key catalog__entry__key--title",
            },
            dragHandle,
            expandButton,
            isEditing === EDIT_KEY
              ? /* @__PURE__ */ React4.createElement(EditValue, {
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
              : /* @__PURE__ */ React4.createElement(
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
              /* @__PURE__ */ React4.createElement(CatalogEntry, {
                key: childId,
                catalogContext,
                colorIdx,
                depth: depth + 1,
                entryId: childId,
                forceRemove: removedState ? true : void 0,
                parentId: entryId,
              })
            )
          : null
      );
    }
  };

  // src/createDiff.ts
  var EMPTY_LIST = [];
  var getDiff = (
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
    const hierarchyDiff = /* @__PURE__ */ new Map();
    const valueEntryDiff = /* @__PURE__ */ new Map();
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
        hierarchyDiff.set(
          resolvePath(entryId),
          otherChildren.map((childId) => resolvePath(childId))
        );
      }
    });
    const allValueEntries = new Set(
      Array.from(valueEntries.keys()).concat(
        Array.from(otherValueEntries.keys())
      )
    );
    allValueEntries.forEach((entryId) => {
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
          valueEntryDiff.set(resolvePath(entryId), otherValueEntry);
        } else if (valueEntry && !otherValueEntry) {
          valueEntryDiff.set(resolvePath(entryId), null);
        }
      }
    });
    const mergedDiff = /* @__PURE__ */ new Map();
    Array.from(hierarchyDiff.entries()).forEach(
      ([hierarchyId, newChildren]) => {
        mergedDiff.set(hierarchyId, { hierarchyDiff: newChildren });
      }
    );
    Array.from(valueEntryDiff.entries()).forEach(([valueEntryId, newValue]) => {
      if (!mergedDiff.has(valueEntryId)) {
        mergedDiff.set(valueEntryId, { valueDiff: newValue });
      } else {
        const currentDiffEntry = mergedDiff.get(valueEntryId);
        currentDiffEntry.valueDiff = newValue;
      }
    });
    return Object.fromEntries(mergedDiff.entries());
  };

  // src/Catalog.tsx
  var getPropertyText = (properties) => {
    if (properties.length > 4) {
      return `${properties
        .slice(0, 3)
        .map((val) => `"${val}"`)
        .join(", ")}, and ${properties.length - 3} others`;
    } else {
      return properties.join(", ");
    }
  };
  var DRAG_OFFSET = 5;
  var CatalogDragCompanion = ({ catalogId, entryId }) => {
    const catalogState = getCatalogState(catalogId);
    const [entryValue] = catalogState[VALUE_IDX].get(entryId);
    const hasHierarchy =
      catalogState[HIERARCHY_IDX].has(entryId) &&
      catalogState[HIERARCHY_IDX].get(entryId).length > 0;
    const [position, setPosition] = React5.useState({
      x: null,
      y: null,
    });
    React5.useEffect(() => {
      const updateCompanionPosition = (event) => {
        setPosition({ x: event.pageX, y: event.pageY });
      };
      window.addEventListener("pointermove", updateCompanionPosition);
      return () => {
        window.removeEventListener("pointermove", updateCompanionPosition);
      };
    }, [setPosition]);
    return position.x !== null && position.y !== null
      ? /* @__PURE__ */ React5.createElement(
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
  var CatalogButtons = ({
    catalogId,
    catalogInitialState,
    removedEntries,
    undeleteAll,
  }) => {
    const [showNewEntry, setShowNewEntry] = React5.useState(false);
    const onSubmitCb = React5.useCallback(() => {
      const catalogState = getCatalogState(catalogId);
      console.log(getDiff(catalogInitialState, catalogState, removedEntries));
    }, [catalogId, removedEntries]);
    return /* @__PURE__ */ React5.createElement(
      React5.Fragment,
      null,
      showNewEntry
        ? /* @__PURE__ */ React5.createElement(NewEntryForm, {
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
      /* @__PURE__ */ React5.createElement(
        "div",
        {
          className: "catalog-buttons",
        },
        /* @__PURE__ */ React5.createElement(
          "button",
          {
            className: "catalog-buttons__submit",
            onClick: onSubmitCb,
          },
          "Submit"
        ),
        /* @__PURE__ */ React5.createElement(
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
        /* @__PURE__ */ React5.createElement(
          "button",
          {
            onClick: () => setShowNewEntry(!showNewEntry),
          },
          "New entry"
        )
      )
    );
  };
  var Catalog = ({ data }) => {
    const didUnmount = React5.useRef(false);
    const firstTimeRef = React5.useRef(true);
    const [isDragActive, internal__setIsDragActive] = React5.useState(false);
    const catalogId = useInitializeCatalogState(data);
    const catalogInitialStateRef = React5.useRef(
      firstTimeRef ? getCatalogState(catalogId) : null
    );
    const [currentDragTarget, setDragTarget] = React5.useState(null);
    const [currentDragSource, setDragSource] = React5.useState(null);
    const [removedEntries, setRemovedEntries] = React5.useState(
      /* @__PURE__ */ new Set()
    );
    const toggleRemoveEntry = React5.useCallback(
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
    const setIsDragActive = React5.useCallback(
      (newValue) => {
        if (!didUnmount.current) {
          internal__setIsDragActive(newValue);
        }
      },
      [internal__setIsDragActive]
    );
    React5.useEffect(
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
    return /* @__PURE__ */ React5.createElement(
      "div",
      {
        className: "catalog-container",
      },
      /* @__PURE__ */ React5.createElement(
        "ul",
        {
          className: "catalog",
        },
        rootEntries.map((entryId, idx) =>
          /* @__PURE__ */ React5.createElement(CatalogEntry, {
            key: entryId,
            catalogContext,
            colorIdx: idx,
            entryId,
            parentId: ROOT_ID,
          })
        ),
        isDragActive && currentDragSource !== null
          ? /* @__PURE__ */ React5.createElement(CatalogDragCompanion, {
              catalogId,
              entryId: currentDragSource,
            })
          : null
      ),
      /* @__PURE__ */ React5.createElement(CatalogButtons, {
        catalogId,
        catalogInitialState: catalogInitialStateRef.current,
        removedEntries,
        undeleteAll: () => setRemovedEntries(/* @__PURE__ */ new Set()),
      })
    );
  };

  // src/index.tsx
  var body = document.body;
  var appContainer = document.createElement("div");
  body.appendChild(appContainer);
  var testData = [
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
  var testData2 = [
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
  var wrapperStyle = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "10px",
  };
  ReactDOM2.render(
    /* @__PURE__ */ React.createElement(
      "div",
      {
        style: wrapperStyle,
      },
      /* @__PURE__ */ React.createElement(Catalog, {
        data: testData,
      }),
      /* @__PURE__ */ React.createElement(Catalog, {
        data: testData2,
      })
    ),
    appContainer
  );
})();
