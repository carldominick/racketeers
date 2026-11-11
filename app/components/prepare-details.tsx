"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function PrepareDetails({ title, context, children, onClose }: {
  title: string;
  context: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const query = matchMedia("(max-width: 1000px)");
    const update = () => setDrawer(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (drawer && element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [drawer]);

  const content = <>
    <header className="prepare-detail-head">
      <div><h2 id={titleId}>{title}</h2><p>{context}</p></div>
      <button type="button" className="secondary" onClick={onClose}>Close</button>
    </header>
    {children}
  </>;

  return drawer ? <dialog className="card prepare-detail prepare-drawer" ref={dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}>{content}</dialog>
    : <aside className="card prepare-detail" aria-labelledby={titleId}>{content}</aside>;
}
