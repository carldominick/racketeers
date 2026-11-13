"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const ASSIGNMENT_CHIMES = ["umpire-assignment"] as const;
export const DESK_CHIMES = ["game-finished", "court-needs-help"] as const;
type Chime = typeof ASSIGNMENT_CHIMES[number] | typeof DESK_CHIMES[number];

export function useCourtChimes(clips: readonly Chime[]) {
  const [status, setStatus] = useState<"off" | "loading" | "on" | "unavailable">("off");
  const player = useRef<{ context: AudioContext; buffers: Map<Chime, AudioBuffer>; nextAt: number; abort: AbortController } | null>(null);

  const stop = useCallback(() => {
    const current = player.current;
    player.current = null;
    current?.abort.abort();
    if (current) void current.context.close();
  }, []);
  useEffect(() => stop, [stop]);

  const toggle = async () => {
    if (player.current) {
      stop();
      setStatus("off");
      return;
    }
    setStatus("loading");
    let current: typeof player.current = null;
    try {
      const context = new AudioContext();
      current = { context, buffers: new Map<Chime, AudioBuffer>(), nextAt: 0, abort: new AbortController() };
      player.current = current;
      const { buffers, abort } = current;
      // Resume within the click so browsers that block autoplay allow later alerts.
      await Promise.all([context.resume(), ...clips.map(async clip => {
        const response = await fetch(`/assets/court-chimes/${clip}.wav`, { signal: abort.signal });
        if (!response.ok) throw new Error("Court chime unavailable");
        buffers.set(clip, await context.decodeAudioData(await response.arrayBuffer()));
      })]);
      if (player.current === current) setStatus("on");
    } catch {
      if (player.current !== current) return;
      stop();
      setStatus("unavailable");
    }
  };

  const play = useCallback((clip: Chime) => {
    const current = player.current;
    const buffer = current?.buffers.get(clip);
    if (!current || !buffer || current.context.state !== "running") return;
    const source = current.context.createBufferSource();
    source.buffer = buffer;
    source.connect(current.context.destination);
    const start = Math.max(current.context.currentTime, current.nextAt);
    source.start(start);
    current.nextAt = start + buffer.duration + 0.12;
    source.onended = () => source.disconnect();
  }, []);

  return { status, toggle, play };
}
