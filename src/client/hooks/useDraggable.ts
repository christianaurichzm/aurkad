import { useEffect, useRef, useState } from 'react';

const isInteractiveTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest('button, input, select, textarea, a');

export const useDraggable = (initialX = 0, initialY = 0) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragRef = useRef({
    dragging: false,
    offsetX: 0,
    offsetY: 0,
    pointerId: null as number | null,
  });

  const onMouseDown = (e: React.MouseEvent) => {
    if (!ref.current || isInteractiveTarget(e.target)) return;
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    dragRef.current = {
      dragging: true,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      pointerId: null,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!ref.current || isInteractiveTarget(e.target)) return;
    e.preventDefault();
    const rect = ref.current.getBoundingClientRect();
    dragRef.current = {
      dragging: true,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  useEffect(() => {
    const moveTo = (clientX: number, clientY: number) => {
      setPos({
        x: clientX - dragRef.current.offsetX,
        y: clientY - dragRef.current.offsetY,
      });
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

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDragging);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDragging);
    };
  }, []);

  return { ref, pos, onMouseDown, onPointerDown };
};
