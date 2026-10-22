"use client";
import { useEffect, useRef, useState } from "react";
import { courtViewSnapshot } from "../../lib/court-view";

export function useCourtWindow(organizerPin: string) {
  const latest = useRef({ organizerPin });
  const channel = useRef<BroadcastChannel | null>(null);
  const child = useRef<Window | null>(null);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => { latest.current = { organizerPin }; }, [organizerPin]);
  useEffect(() => () => { channel.current?.close(); channel.current = null; }, []);
  useEffect(() => {
    if (!organizerPin) { channel.current?.close(); channel.current = null; }
  }, [organizerPin]);
  const open = () => {
    setError("");
    if (child.current && !child.current.closed) { child.current.focus(); return; }
    channel.current?.close();
    const nonce = crypto.randomUUID();
    let pending = false;
    // Only this random, short-lived channel carries a whitelisted display projection.
    // Staff PINs stay in the organizer window and never enter the URL/child storage.
    const bus = new BroadcastChannel(`racketeers-courts-${nonce}`);
    channel.current = bus;
    bus.onmessage = async event => {
      if (event.data?.type !== "refresh" || pending || !latest.current.organizerPin) return;
      pending = true;
      try {
        const response = await fetch("/api/state", { headers: { "x-organizer-pin": latest.current.organizerPin }, cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!data.organizer) throw new Error();
        if (channel.current === bus && latest.current.organizerPin) bus.postMessage({ type: "snapshot", snapshot: courtViewSnapshot(data.state, true) });
      } catch { if (channel.current === bus) bus.postMessage({ type: "disconnected" }); }
      finally { pending = false; }
    };
    const href = `/courts#${nonce}`;
    setUrl(href);
    child.current = window.open(href, "racketeers-court-view", "popup,width=1600,height=1000");
    if (child.current) child.current.opener = null;
    if (!child.current) setError("The pop-up was blocked. Use Open court view in a tab below, or allow pop-up windows for this site.");
  };
  return { open, error, url };
}
