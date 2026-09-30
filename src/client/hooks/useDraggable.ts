import { useCallback, useEffect, useRef, useState } from 'react';

const isInteractiveTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('button, input, select, textarea, a');

const MARGIN = 8;

// Keeps a panel where a finger can reach it: not dragged past an edge, and
// not opened at a desktop offset off a phone screen.
const clampToViewport = (
  x: number,
  y: number,
  el: HTMLElement,
): { x: number; y: number } => {
  const { width, height } = el.getBoundingClientRect();
  const maxX = Math.max(MARGIN, window.innerWidth - width - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - height - MARGIN);
  return {
    x: Math.min(Math.max(MARGIN, x), maxX),
    y: Math.min(Math.max(MARGIN, y), maxY),
  };
};

export const useDraggable = (initialX = 0, initialY = 0) => {
  const node = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragRef = useRef({
    dragging: false,
    offsetX: 0,
    offsetY: 0,
    pointerId: null as number | null,
  });

  // A callback ref, since these panels render null while closed and the
  // element appears when it opens, which is when its size can be checked.
  const ref = useCallback((el: HTMLDivElement | null) => {
    node.current = el;
    if (!el) return;
    const fit = () =>
      setPos((current) => {
        const next = clampToViewport(current.x, current.y, el);
        return next.x === current.x && next.y === current.y ? current : next;
      });
    fit();
    // Content often arrives after the window opens and grows it past the edge.
    const grown = new ResizeObserver(fit);
    grown.observe(el);
    return () => {
      grown.disconnect();
      node.current = null;
    };
  }, []);

  const startDrag = (
    clientX: number,
    clientY: number,
    target: EventTarget | null,
    pointerId: number | null,
  ) => {
    if (!node.current || isInteractiveTarget(target)) return false;
    if (
      window.matchMedia(
        '(max-width: 700px), (pointer: coarse) and (max-height: 600px)',
      ).matches
    )
      return false;
    const rect = node.current.getBoundingClientRect();
    dragRef.current = {
      dragging: true,
      offsetX: clientX - rect.left,
      offsetY: clientY - rect.top,
      pointerId,
    };
    return true;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (startDrag(e.clientX, e.clientY, e.target, null)) e.preventDefault();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!startDrag(e.clientX, e.clientY, e.target, e.pointerId)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  useEffect(() => {
    const moveTo = (clientX: number, clientY: number) => {
      const x = clientX - dragRef.current.offsetX;
      const y = clientY - dragRef.current.offsetY;
      setPos(node.current ? clampToViewport(x, y, node.current) : { x, y });
    };
    const stopDragging = () => {
      dragRef.current.dragging = false;
      dragRef.current.pointerId = null;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current.dragging) return;
      if (
        dragRef.current.pointerId !== null &&
        dragRef.current.pointerId !== e.pointerId
      ) {
        return;
      }
      moveTo(e.clientX, e.clientY);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      if (dragRef.current.pointerId !== null) return;
      moveTo(e.clientX, e.clientY);
    };

    // Rotating the phone changes which positions exist at all.
    const onResize = () => {
      if (!node.current) return;
      const el = node.current;
      setPos((current) => clampToViewport(current.x, current.y, el));
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return { ref, pos, onMouseDown, onPointerDown };
};
