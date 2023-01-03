// keep track of the insert order, in other words
// this dictates should the dragged element be inserted
// before or after the target element
let insertOrder = null;
export const setInsertOrder = (order) => {
  insertOrder = order;
};
export const getInsertOrder = () => insertOrder;
