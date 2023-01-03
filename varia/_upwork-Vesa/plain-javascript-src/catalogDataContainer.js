import * as React from "react";
export const ROOT_ID = 0;
export const HIERARCHY_IDX = 0;
export const VALUE_IDX = 1;
const catalogStateContainer = new Map();
const subscriberFuncs = new Map();
export const getCatalogState = (catalogId) =>
  catalogStateContainer.get(catalogId);
export const setCatalogState = (catalogId, nextState) => {
  catalogStateContainer.set(catalogId, nextState);
  const subscribers = subscriberFuncs.get(catalogId);

  if (subscribers) {
    subscribers.forEach((subscriberFunc) => {
      subscriberFunc(nextState);
    });
  }
};
export const updateCatalogState = (catalogId, reducerFunc, action) => {
  const state = catalogStateContainer.get(catalogId);
  const nextState = reducerFunc(state, action);
  setCatalogState(catalogId, nextState);
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

export const useInitializeCatalogState = (initialData) => {
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

export const useHierarchyEntry = (catalogId, entryId) =>
  useCatalogEntry(catalogId, entryId, HIERARCHY_IDX);
export const useValueEntry = (catalogId, entryId) =>
  useCatalogEntry(catalogId, entryId, VALUE_IDX);

