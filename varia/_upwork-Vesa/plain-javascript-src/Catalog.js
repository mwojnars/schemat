import "./_catalog.scss";
import * as React from "react";
import { CatalogEntry } from "./CatalogEntry";
import { NewEntryForm } from "./NewEntryForm";
import { addEntryReducer } from "./catalogReducers";
import { getDiff } from "./createDiff";
import {
  HIERARCHY_IDX,
  ROOT_ID,
  VALUE_IDX,
  getCatalogState,
  setCatalogState,
  useInitializeCatalogState,
  useHierarchyEntry,
} from "./catalogDataContainer";

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

export const Catalog = ({ data }) => {
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

