import { type CatalogState } from "./catalogDataContainer";

export type UpdateValueEntryAction = {
    entryId: number;
    newValue: [string, string];
};

export const updateValueEntryReducer = (
    catalogState: CatalogState,
    { entryId, newValue }: UpdateValueEntryAction
): CatalogState => {
    const [hierarchy, valueEntries] = catalogState;
    const nextValueEntries: CatalogState[1] = new Map(valueEntries);
    nextValueEntries.set(entryId, newValue);

    return [hierarchy, nextValueEntries];
};

export type ReorderAction = {
    targetId: number;
    sourceId: number;
    insertOrder: "before" | "after";
};

// applies reordering action and updates the hierarchy (immutable action)
export const reorderReducer = (
    catalogState: CatalogState,
    { targetId, sourceId, insertOrder }: ReorderAction
): CatalogState => {
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

    const nextHierarchy: CatalogState[0] = new Map(hierarchy);

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

export type AddEntryAction = {
    hierarchyId: number;
    entryType: "atomic" | "sublist";
    entryData: [string, string];
};
export const addEntryReducer = (
    [hierarchy, entryValues]: CatalogState,
    { hierarchyId: parentId, entryType, entryData }: AddEntryAction
): CatalogState => {
    const nextHierarchy: CatalogState[0] = new Map(hierarchy);

    const nextId: number =
        Array.from(entryValues.keys()).sort((a, b) => b - a)[0] + 1;
    const nextChildren = nextHierarchy.get(parentId).concat(nextId);

    const nextValues: CatalogState[1] = new Map(entryValues);

    nextHierarchy.set(parentId, nextChildren);
    nextValues.set(nextId, entryData);

    if (entryType === "sublist") {
        nextHierarchy.set(nextId, []);
    }

    return [nextHierarchy, nextValues];
};

export type ConvertToSublistAction = { entryId: number };
export const convertToSublistReducer = (
    catalogState: CatalogState,
    { entryId }: ConvertToSublistAction
): CatalogState => {
    const [hierarchy, entryValues] = catalogState;

    if (!hierarchy.has(entryId)) {
        const nextHierarchy: CatalogState[0] = new Map(hierarchy);
        nextHierarchy.set(entryId, []);
        return [nextHierarchy, entryValues];
    } else {
        return catalogState;
    }
};
