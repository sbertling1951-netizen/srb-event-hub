"use client";

import { useLayoutEffect, useRef } from "react";

import { Dialog, type DialogProps } from "./Dialog";

/** Move a parent-controlled inline form into a modal without shrinking the page.
 * Edit triggers must remain outside the moved form so focus can return to them.
 */
export function RecordEditorSurface(props: DialogProps) {
  const inlineRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(0);
  useLayoutEffect(() => {
    if (props.open || !inlineRef.current) {return;}
    const surface = inlineRef.current;
    const measure = () => { heightRef.current = surface.getBoundingClientRect().height; };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [props.open]);
  return (
    <div ref={inlineRef} style={{ minHeight: props.open ? heightRef.current : undefined }}>
      {props.open ? <Dialog {...props} /> : props.children}
    </div>
  );
}
