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
    type CatalogState,
    type DataEntry,
    useHierarchyEntry,
} from "./catalogDataContainer";

type Position = {
    x: number;
    y: number;
};

const getPropertyText = (properties: string[]) => {
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
const CatalogDragCompanion = ({
    catalogId,
    entryId,
}: {
    catalogId: number;
    entryId: number;
}) => {
    const catalogState = getCatalogState(catalogId);
    const [entryValue] = catalogState[VALUE_IDX].get(entryId);
    const hasHierarchy =
        catalogState[HIERARCHY_IDX].has(entryId) &&
        catalogState[HIERARCHY_IDX].get(entryId).length > 0;
    const [position, setPosition] = React.useState<Position>({
        x: null,
        y: null,
    });
    React.useEffect(() => {
        const updateCompanionPosition = (event: PointerEvent) => {
            setPosition({ x: event.pageX, y: event.pageY });
        };

        window.addEventListener("pointermove", updateCompanionPosition);

        return () => {
            window.removeEventListener("pointermove", updateCompanionPosition);
        };
    }, [setPosition]);

    return position.x !== null && position.y !== null ? (
        <li
            style={{
                transform: `translate(${position.x + DRAG_OFFSET}px, ${
                    position.y + DRAG_OFFSET
                }px)`,
            }}
            className="catalog__drag-companion"
        >
            {`Dragging "${entryValue}"`}
            {hasHierarchy
                ? ` (with ${getPropertyText(
                      catalogState[HIERARCHY_IDX].get(entryId).map(
                          (idx) => catalogState[VALUE_IDX].get(idx)[0]
                      )
                  )})`
                : null}
        </li>
    ) : null;
};

const CatalogButtons = ({
    catalogId,
    catalogInitialState,
    removedEntries,
    undeleteAll,
}: {
    catalogId: number;
    catalogInitialState: CatalogState;
    removedEntries: Set<number>;
    undeleteAll: () => void;
}) => {
    const [showNewEntry, setShowNewEntry] = React.useState(false);
    const onSubmitCb = React.useCallback(() => {
        const catalogState = getCatalogState(catalogId);
        console.log(getDiff(catalogInitialState, catalogState, removedEntries));
    }, [catalogId, removedEntries]);
    return (
        <>
            {showNewEntry ? (
                <NewEntryForm
                    onAdd={(entryType, entryData) => {
                        setCatalogState(
                            catalogId,
                            addEntryReducer(getCatalogState(catalogId), {
                                hierarchyId: ROOT_ID,
                                entryType,
                                entryData,
                            })
                        );
                        setShowNewEntry(false);
                    }}
                    onCancel={() => setShowNewEntry(false)}
                />
            ) : null}
            <div className="catalog-buttons">
                <button
                    className="catalog-buttons__submit"
                    onClick={onSubmitCb}
                >
                    Submit
                </button>
                <button
                    className="catalog-buttons__reset"
                    onClick={() => {
                        setCatalogState(catalogId, catalogInitialState);
                        undeleteAll();
                    }}
                >
                    Reset
                </button>
                <button onClick={() => setShowNewEntry(!showNewEntry)}>
                    New entry
                </button>
            </div>
        </>
    );
};

export const Catalog = ({ data }: { data: DataEntry[] }) => {
    const didUnmount = React.useRef(false);
    const firstTimeRef = React.useRef<boolean>(true);

    // do not expose internal outside this component without capsulation!
    const [isDragActive, internal__setIsDragActive] =
        React.useState<boolean>(false);

    const catalogId = useInitializeCatalogState(data);
    const catalogInitialStateRef = React.useRef<CatalogState>(
        firstTimeRef ? getCatalogState(catalogId) : null
    );

    const [currentDragTarget, setDragTarget] = React.useState<number | null>(
        null
    );
    const [currentDragSource, setDragSource] = React.useState<number | null>(
        null
    );

    const [removedEntries, setRemovedEntries] = React.useState<Set<number>>(
        new Set()
    );
    const toggleRemoveEntry = React.useCallback(
        (entryId: number, removedState?: boolean) => {
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
        (newValue: boolean) => {
            if (!didUnmount.current) {
                // check that this component still exists first!
                internal__setIsDragActive(newValue);
            }
        },
        [internal__setIsDragActive]
    );

    // set didUnmount when unmounting
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

    return (
        <div className="catalog-container">
            <ul className="catalog">
                {rootEntries.map((entryId, idx) => (
                    <CatalogEntry
                        key={entryId}
                        catalogContext={catalogContext}
                        colorIdx={idx}
                        entryId={entryId}
                        parentId={ROOT_ID}
                    />
                ))}
                {isDragActive && currentDragSource !== null ? (
                    <CatalogDragCompanion
                        catalogId={catalogId}
                        entryId={currentDragSource}
                    />
                ) : null}
            </ul>
            <CatalogButtons
                catalogId={catalogId}
                catalogInitialState={catalogInitialStateRef.current}
                removedEntries={removedEntries}
                undeleteAll={() => setRemovedEntries(new Set())}
            />
        </div>
    );
};
