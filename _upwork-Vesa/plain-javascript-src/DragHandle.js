export const DragHandle = ({ onPointerDown, onPointerMove }) =>
  /*#__PURE__*/ React.createElement(
    "span",
    {
      onPointerDown: onPointerDown,
      onPointerMove: onPointerMove,
      className: "drag-handle",
    },
    "\u22ee\u22ee"
  );

