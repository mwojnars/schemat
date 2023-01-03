import * as React from "react";

export type CatalogState = [
    hierarchies: Map<number, number[]>,
    values: Map<number, [string, string]>
];
// alias
export type FlattenDataAcc = CatalogState;

export type DataEntry = [key: string, value: DataEntry[] | string];

type CatalogSubscriptionFunc = (nextCatalogState: CatalogState) => void;

export const ROOT_ID = 0;
export const HIERARCHY_IDX = 0;
export const VALUE_IDX = 1;

const catalogStateContainer: Map<number, CatalogState> = new Map();

const subscriberFuncs: Map<number, Set<CatalogSubscriptionFunc>> = new Map();

export const getCatalogState = (catalogId: number): CatalogState =>
    catalogStateContainer.get(catalogId);

export const setCatalogState = (catalogId: number, nextState: CatalogState) => {
    catalogStateContainer.set(catalogId, nextState);
    const subscribers = subscriberFuncs.get(catalogId);

    if (subscribers) {
        subscribers.forEach((subscriberFunc) => {
            subscriberFunc(nextState);
        });
    }
};

export const updateCatalogState = <T>(
    catalogId: number,
    reducerFunc: (state: CatalogState, action?: T) => CatalogState,
    action?: T
): void => {
    const state = catalogStateContainer.get(catalogId);
    const nextState = reducerFunc(state, action);
    setCatalogState(catalogId, nextState);
};

const subscribeToCatalogState = (
    catalogId: number,
    subscriberFunc: CatalogSubscriptionFunc
): (() => void) => {
    if (!subscriberFuncs.has(catalogId)) {
        subscriberFuncs.set(catalogId, new Set());
    }

    subscriberFuncs.get(catalogId).add(subscriberFunc);

    // returns unsubscribe function
    return () => {
        subscriberFuncs.get(catalogId).delete(subscriberFunc);
        if (subscriberFuncs.get(catalogId).size === 0) {
            // delete empty subscriber container
            subscriberFuncs.delete(catalogId);
        }
    };
};

const isValueEntry = (entry: DataEntry): entry is [string, string] =>
    typeof entry[1] === "string";

const isSublistEntry = (entry: DataEntry): entry is [string, DataEntry[]] =>
    !isValueEntry(entry);

// Create flattened version of the list representation.
// Returns separate hierarchy and value maps
const reducerFunc = (
    acc: FlattenDataAcc,
    current: DataEntry,
    parentId: number,
    idRef: { current: number }
) => {
    const id = idRef.current;
    idRef.current = idRef.current + 1;
    const [hierarchyAcc, valueAcc] = acc;
    if (isValueEntry(current)) {
        // current value is an atomic (string)
        valueAcc.set(id, current);
    } else if (isSublistEntry(current)) {
        // current value is a sublist
        hierarchyAcc.set(id, []);

        // Perhaps later on sublist can also have a description
        // ( = value field)
        valueAcc.set(id, [current[0], current[0]]);
        current[1].forEach((currentChild) =>
            reducerFunc(acc, currentChild, id, idRef)
        );
    }

    // add current id to parent's hierarchy items
    hierarchyAcc.get(parentId).push(id);

    return acc;
};

const flattenData = (data: DataEntry[]): FlattenDataAcc => {
    const idRef = { current: ROOT_ID + 1 };

    const initAcc: FlattenDataAcc = [new Map(), new Map()];
    initAcc[0].set(ROOT_ID, []);

    return data.reduce(
        (acc: FlattenDataAcc, current) =>
            reducerFunc(acc, current, ROOT_ID, idRef),
        initAcc
    );
};

let catalogIdCounter: number = 1;
const nextCatalogId = () => {
    const currentId = catalogIdCounter;
    catalogIdCounter = catalogIdCounter + 1;
    return currentId;
};

export const useInitializeCatalogState = (initialData: DataEntry[]) => {
    const catalogIdRef = React.useRef<number | null>(null);

    if (catalogIdRef.current !== null) {
        // the state has already been created,
        // only return the identifier to the corresponding
        // data container entry
        return catalogIdRef.current;
    } else {
        const catalogId = nextCatalogId();
        const catalogState: CatalogState = flattenData(initialData);
        catalogStateContainer.set(catalogId, catalogState);

        catalogIdRef.current = catalogId;
        return catalogIdRef.current;
    }
};

type HookReturnType<T extends typeof HIERARCHY_IDX | typeof VALUE_IDX> =
    T extends typeof HIERARCHY_IDX ? number[] : [string, string];

const useCatalogEntry = <T extends typeof HIERARCHY_IDX | typeof VALUE_IDX>(
    catalogId: number,
    entryId: number,
    dataIdx: T
): HookReturnType<T> => {
    const firstTimeRef = React.useRef(true);
    const [counter, setCounter] = React.useState(0);
    const dataEntryRef = React.useRef<HookReturnType<T>>(null);
    const unsubscribeFuncRef = React.useRef<() => void>(null);

    // create a reference to state counter which is needed in the
    // subscriberFunc. Otherwise the reference to the counter
    // is obsoleted
    const counterRef = React.useRef<number>();
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
        const subscriberFunc: CatalogSubscriptionFunc = (state) => {
            const nextValue = state[dataIdx].get(entryId);
            if (nextValue !== dataEntryRef.current) {
                dataEntryRef.current = nextValue as HookReturnType<T>;
                setCounter(counterRef.current + 1);
            }
        };
        unsubscribeFuncRef.current = subscribeToCatalogState(
            catalogId,
            subscriberFunc
        );

        // assign initial value from state
        dataEntryRef.current = catalogStateContainer
            .get(catalogId)
            [dataIdx].get(entryId) as HookReturnType<T>;
    }

    return dataEntryRef.current;
};

export const useHierarchyEntry = (catalogId: number, entryId: number) =>
    useCatalogEntry(catalogId, entryId, HIERARCHY_IDX);

export const useValueEntry = (catalogId: number, entryId: number) =>
    useCatalogEntry(catalogId, entryId, VALUE_IDX);
