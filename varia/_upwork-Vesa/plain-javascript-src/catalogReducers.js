export const updateValueEntryReducer = (
  catalogState,
  { entryId, newValue }
) => {
  const [hierarchy, valueEntries] = catalogState;
  const nextValueEntries = new Map(valueEntries);
  nextValueEntries.set(entryId, newValue);
  return [hierarchy, nextValueEntries];
};
// applies reordering action and updates the hierarchy (immutable action)
export const reorderReducer = (
  catalogState,
  { targetId, sourceId, insertOrder }
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
export const addEntryReducer = (
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
export const convertToSublistReducer = (catalogState, { entryId }) => {
  const [hierarchy, entryValues] = catalogState;

  if (!hierarchy.has(entryId)) {
    const nextHierarchy = new Map(hierarchy);
    nextHierarchy.set(entryId, []);
    return [nextHierarchy, entryValues];
  } else {
    return catalogState;
  }
};

