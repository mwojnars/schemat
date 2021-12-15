import { ROOT_ID } from "./catalogDataContainer";
const EMPTY_LIST = [];
export const getDiff = (
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

