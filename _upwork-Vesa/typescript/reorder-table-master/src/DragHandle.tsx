export const DragHandle = ({
    onPointerDown,
    onPointerMove,
}: {
    onPointerDown: (event: React.PointerEvent<HTMLSpanElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLSpanElement>) => void;
}) => (
    <span
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        className="drag-handle"
    >
        {"\u22ee\u22ee"}
    </span>
);
