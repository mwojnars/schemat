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
    type AddEntryAction,
    type ReorderAction,
    type UpdateValueEntryAction,
    addEntryReducer,
    reorderReducer,
    updateValueEntryReducer,
} from "./catalogReducers";

const updateValueEntry = (
    catalogId: number,
    updateValueEntryAction: UpdateValueEntryAction
) => {
    setCatalogState(
        catalogId,
        updateValueEntryReducer(
            getCatalogState(catalogId),
            updateValueEntryAction
        )
    );
};

const addEntry = (catalogId: number, addEntryAction: AddEntryAction) => {
    setCatalogState(
        catalogId,
        addEntryReducer(getCatalogState(catalogId), addEntryAction)
    );
};

const reorder = (catalogId: number, reorderAction: ReorderAction) => {
    setCatalogState(
        catalogId,
        reorderReducer(getCatalogState(catalogId), reorderAction)
    );
};

const EditValue = ({
    className,
    initialValue = "",
    onFinish,
}: {
    onFinish: (newValue: string) => void;
    className?: string;
    initialValue?: string;
}) => {
    const inputRef = React.useRef<HTMLInputElement>();
    const [localValue, setLocalValue] = React.useState<string>(initialValue);

    const finishEditing = React.useCallback(() => {
        onFinish(localValue.trim() ? localValue : initialValue);
    }, [onFinish, localValue]);

    const onChange: React.ChangeEventHandler<HTMLInputElement> =
        React.useCallback(
            (event) => {
                setLocalValue(event.target.value);
            },
            [setLocalValue]
        );

    const onKeyPress: React.KeyboardEventHandler<HTMLInputElement> =
        React.useCallback(
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

    return (
        <input
            data-editable={true}
            ref={inputRef}
            className={className}
            onBlur={finishEditing}
            onChange={onChange}
            onKeyPress={onKeyPress}
            value={localValue}
        />
    );
};

const EDIT_KEY = 0;
const EDIT_VALUE = 1;

type CatalogEntryProps = {
    catalogContext: {
        catalogId: number;
        currentDragSource: number | null;
        currentDragTarget: number | null;
        isDragActive: boolean;
        removedEntries: Set<number>;
        setDragSource: (entryId: number) => void;
        setDragTarget: (entryId: number) => void;
        setIsDragActive: (isActive: boolean) => void;
        toggleRemoveEntry: (entryId: number, newState?: boolean) => void;
    };
    colorIdx: number;
    depth?: number;
    entryId: number;
    forceRemove?: boolean;
    parentId: number;
};

export const CatalogEntry = ({
    catalogContext,
    colorIdx = 0,
    depth = 0,
    entryId,
    forceRemove,
    parentId,
}: CatalogEntryProps) => {
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
    const [isEditing, setEditMode] = React.useState<
        typeof EDIT_KEY | typeof EDIT_VALUE | false
    >(false);
    // Local insert order is used for the drop indicator ( = placeholder).
    // Local value is updated into global ref by "pointer up" event
    const [localInsertOrder, setLocalInsertOrder] = React.useState<
        "before" | "after" | null
    >(null);
    const isRemoved = removedEntries.has(entryId);
    const removedState = forceRemove ?? isRemoved;
    const [showDragHandle, setShowDragHandle] = React.useState(false);
    const [showNewEntryForm, setShowNewEntryForm] = React.useState(false);
    const [isExpanded, setIsExpanded] = React.useState(true);
    const onPointerDown = () => {
        setIsDragAllowed(true);
        setDragSource(entryId);

        // initialize pointer up event here to clear the
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
        !isDragActive && showDragHandle ? (
            <DragHandle
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
            />
        ) : null;

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

    const editfieldRef = React.useRef<HTMLInputElement>();

    // entries which belong to ROOT_ID's hierarchy are considered to be 'root entries'
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

    const insertUtilBefore = isDragActive && localInsertOrder !== "before" && (
        <div
            onPointerEnter={() => setLocalInsertOrder("before")}
            className="insert-order-util insert-order-util--before"
        />
    );
    const insertUtilAfter = isDragActive && localInsertOrder !== "after" && (
        <div
            onPointerEnter={() => setLocalInsertOrder("after")}
            className="insert-order-util insert-order-util--after"
        />
    );

    const removeButton =
        forceRemove === undefined && !isDragActive && showDragHandle ? (
            <span
                title={!isRemoved ? "Remove entry" : "Undo remove"}
                className="catalog__remove-entry"
                onClick={() => {
                    toggleRemoveEntry(entryId, !isRemoved);
                }}
            >
                {!isRemoved ? "\u2715" : "\u238c"}
            </span>
        ) : null;

    if (!hierarchyEntry) {
        return (
            <li {...listPointerEvents} key={entryId} className={entryClasses()}>
                {insertUtilBefore}
                {insertUtilAfter}
                <span
                    onDoubleClick={() => {
                        if (!removedState) {
                            setEditMode(0);
                        }
                    }}
                    className={`catalog__entry__key${
                        isRoot ? " catalog__entry__key--title" : ""
                    }`}
                    style={{ paddingLeft: `${depth * 25}px` }}
                >
                    {dragHandle}
                    {isEditing === EDIT_KEY ? (
                        <EditValue
                            onFinish={(newValue) => {
                                updateValueEntry(catalogId, {
                                    entryId,
                                    newValue: [newValue, valueEntry[1]],
                                });
                                setEditMode(false);
                            }}
                            className="catalog__entry__key__content"
                            initialValue={valueEntry[0]}
                        />
                    ) : (
                        <>
                            <span className="catalog__entry__key__content">
                                {valueEntry[0]}
                            </span>
                            {removeButton}
                        </>
                    )}
                </span>
                <span
                    className="catalog__entry__value"
                    onDoubleClick={() => {
                        if (!removedState) {
                            setEditMode(1);
                        }
                    }}
                >
                    {isEditing === EDIT_VALUE ? (
                        <EditValue
                            className="catalog__entry__value__content"
                            onFinish={(newValue) => {
                                updateValueEntry(catalogId, {
                                    entryId,
                                    newValue: [valueEntry[0], newValue],
                                });
                                setEditMode(false);
                            }}
                            initialValue={valueEntry[1]}
                        />
                    ) : (
                        <span className="catalog__entry__value__content">
                            {valueEntry[1]}
                        </span>
                    )}
                </span>
            </li>
        );
    } else {
        const insertButton =
            showNewEntryForm || (!isDragActive && showDragHandle) ? (
                <span
                    title="Add entry"
                    className={`catalog__add-entry${
                        showNewEntryForm ? " catalog__add-entry--active" : ""
                    }`}
                    onClick={() => setShowNewEntryForm(!showNewEntryForm)}
                >
                    {"\u002b"}
                </span>
            ) : null;
        const expandButton = (
            <span
                onClick={() => setIsExpanded(!isExpanded)}
                className="catalog__expand-button"
            >
                {isExpanded ? "\u25bd" : "\u25b3"}
            </span>
        );

        const newEntryForm = showNewEntryForm ? (
            <NewEntryForm
                indentation={depth}
                onAdd={(
                    entryType: "atomic" | "sublist",
                    entryData: [string, string]
                ) => {
                    addEntry(catalogId, {
                        hierarchyId: entryId,
                        entryType,
                        entryData,
                    });
                    setShowNewEntryForm(false);
                }}
                onCancel={() => setShowNewEntryForm(false)}
            />
        ) : null;

        return (
            <>
                <li {...listPointerEvents} className={entryClasses()}>
                    {insertUtilBefore}
                    {insertUtilAfter}
                    <span
                        style={{ paddingLeft: `${depth * 25}px` }}
                        className="catalog__entry__key catalog__entry__key--title"
                    >
                        {dragHandle}
                        {expandButton}
                        {isEditing === EDIT_KEY ? (
                            <EditValue
                                className="catalog__entry__value__content"
                                onFinish={(newValue) => {
                                    updateValueEntry(catalogId, {
                                        entryId,
                                        newValue: [newValue, valueEntry[1]],
                                    });
                                    setEditMode(false);
                                }}
                                initialValue={valueEntry[0]}
                            />
                        ) : (
                            <span
                                onDoubleClick={() => setEditMode(EDIT_KEY)}
                                className="catalog__entry__key__content"
                            >
                                {valueEntry[0]}
                            </span>
                        )}
                        {insertButton}
                        {removeButton}
                    </span>
                    {newEntryForm}
                </li>
                {isExpanded
                    ? hierarchyEntry.map((childId) => (
                          <CatalogEntry
                              key={childId}
                              catalogContext={catalogContext}
                              colorIdx={colorIdx}
                              depth={depth + 1}
                              entryId={childId}
                              forceRemove={removedState ? true : undefined}
                              parentId={entryId}
                          />
                      ))
                    : null}
            </>
        );
    }
};
