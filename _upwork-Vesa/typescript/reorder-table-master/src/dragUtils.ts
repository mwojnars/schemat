// keep track of the insert order, in other words
// this dictates should the dragged element be inserted
// before or after the target element
let insertOrder: "before" | "after" | null = null;

export const setInsertOrder = (order: "before" | "after") => {
    insertOrder = order;
};

export const getInsertOrder = (): "before" | "after" | null => insertOrder;
