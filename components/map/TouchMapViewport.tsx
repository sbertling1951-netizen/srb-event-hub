"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

type Props = {
  children: React.ReactNode;
  imageUrl?: string;
  width?: number;
  height?: number;
};

export default function TouchMapViewport({ width, height, children }: Props) {
  const [scale, setScale] = useState(0.22);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });

  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const pinchRef = useRef({
    active: false,
    startDistance: 0,
    startScale: 1,
    startTranslateX: 0,
    startTranslateY: 0,
    centerX: 0,
    centerY: 0,
  });

  const scaleRef = useRef(scale);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;

    if (target.closest("button")) {
      return;
    }

    pointersRef.current.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
    });

    if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());

      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;

      const rect = e.currentTarget.getBoundingClientRect();

      pinchRef.current.active = true;
      pinchRef.current.startDistance = Math.hypot(dx, dy);
      pinchRef.current.startScale = scale;
      pinchRef.current.startTranslateX = translate.x;
      pinchRef.current.startTranslateY = translate.y;
      pinchRef.current.centerX = (points[0].x + points[1].x) / 2 - rect.left;
      pinchRef.current.centerY = (points[0].y + points[1].y) / 2 - rect.top;
    } else {
      dragRef.current.active = true;
      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;
      dragRef.current.originX = translate.x;
      dragRef.current.originY = translate.y;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function clampTranslate(nextX: number, nextY: number, nextScale: number) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight * 0.78;

    const scaledWidth = (width || 0) * nextScale;
    const scaledHeight = (height || 0) * nextScale;

    const minX = Math.min(0, viewportWidth - scaledWidth);
    const minY = Math.min(0, viewportHeight - scaledHeight);

    const maxX = 0;
    const maxY = 0;

    return {
      x: Math.max(minX, Math.min(maxX, nextX)),
      y: Math.max(minY, Math.min(maxY, nextY)),
    };
  }

  function smoothZoom(nextScale: number) {
    const clampedScale = Math.min(4, Math.max(0.22, nextScale));

    setScale((prev) =>
      Number((prev + (clampedScale - prev) * 0.22).toFixed(3)),
    );
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });
    }

    if (pinchRef.current.active && pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());

      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;

      const distance = Math.hypot(dx, dy);

      if (distance < pinchRef.current.startDistance + 2) {
        return;
      }
      const nextScale =
        pinchRef.current.startScale *
        (distance / pinchRef.current.startDistance);

      const clampedScale = Math.min(4, Math.max(0.22, nextScale));

      const scaleRatio = clampedScale / pinchRef.current.startScale;

      const nextTranslateX =
        pinchRef.current.startTranslateX -
        (pinchRef.current.centerX *
          (clampedScale - pinchRef.current.startScale)) /
          pinchRef.current.startScale;

      const nextTranslateY =
        pinchRef.current.startTranslateY -
        (pinchRef.current.centerY *
          (clampedScale - pinchRef.current.startScale)) /
          pinchRef.current.startScale;

      const clamped = clampTranslate(
        nextTranslateX,
        nextTranslateY,
        clampedScale,
      );

      const driftX = Math.abs(clamped.x - translate.x);
      const driftY = Math.abs(clamped.y - translate.y);

      if (driftX > 40 || driftY > 40) {
        return;
      }

      setTranslate(clamped);
      setScale(clampedScale);

      return;
    }

    if (!dragRef.current.active) {
      return;
    }

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    const nextX = dragRef.current.originX + dx;
    const nextY = dragRef.current.originY + dy;

    setTranslate({
      x: nextX,
      y: nextY,
    });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size < 2 && pinchRef.current.active) {
      pinchRef.current.active = false;
    }

    dragRef.current.active = false;
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "78vh",
        overflow: "hidden",
        background: "#f2f2f2",
        touchAction: "none",
      }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();

          const tapX = e.clientX - rect.left;
          const tapY = e.clientY - rect.top;

          const nextScale =
            scale >= 3 ? 0.22 : Number((scale + 0.2).toFixed(2));

          const scaleRatio = nextScale / scale;

          const nextTranslateX = tapX - (tapX - translate.x) * scaleRatio;

          const nextTranslateY = tapY - (tapY - translate.y) * scaleRatio;

          setTranslate({
            x: nextTranslateX,
            y: nextTranslateY,
          });

          setScale(nextScale);
        }}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          transformOrigin: "top left",
          touchAction: "none",
        }}
      >
        {children}
      </div>

      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          background: "white",
          padding: 8,
          borderRadius: 12,
        }}
      >
        <button onClick={() => smoothZoom(scale + 0.1)}>+</button>
        <button
          onClick={() => {
            setScale(0.22);
            setTranslate({ x: 0, y: 0 });
          }}
        >
          Reset
        </button>
        <button onClick={() => smoothZoom(scale - 0.1)}>−</button>{" "}
      </div>
    </div>
  );
}
