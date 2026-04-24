"use client";

import { Loader2, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCommandSocket } from "@/hooks/useCommandSocket";
import settingsService from "@/services/settingsService";
import {
  TRACKING_INTERVAL_CHOICES,
  type TrackingIntervalChangedEvent,
  type TrackingIntervalSec,
} from "@/types/command";

/**
 * Floating card that shows — and lets the operator change — the global
 * telemetry cycle. The change broadcasts to every connected mobile client
 * (not just one device), so the whole fleet shifts to the new interval.
 */
export default function TrackingIntervalControl() {
  const [intervalSec, setIntervalSec] = useState<number | null>(null);
  const [pending, setPending] = useState<TrackingIntervalSec | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    settingsService
      .getTrackingInterval()
      .then((res) => {
        if (!cancelled) setIntervalSec(res.intervalSec);
      })
      .catch(() => {
        if (!cancelled) setError("Không tải được cài đặt");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRemoteChange = useCallback(
    (event: TrackingIntervalChangedEvent) => {
      setIntervalSec(event.intervalSec);
      setPending(null);
    },
    [],
  );

  useCommandSocket(
    useMemo(
      () => ({ onTrackingIntervalChanged: handleRemoteChange }),
      [handleRemoteChange],
    ),
  );

  const handleClick = useCallback(async (next: TrackingIntervalSec) => {
    setPending(next);
    setError(null);
    try {
      const res = await settingsService.setTrackingInterval(next);
      setIntervalSec(res.intervalSec);
    } catch {
      setError("Không cập nhật được");
    } finally {
      setPending(null);
    }
  }, []);

  return (
    <div className="absolute right-4 top-4 z-[1000] rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur-sm">
      <div className="mb-2 flex items-center gap-1.5">
        <Timer className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Chu kỳ gửi (chung)
        </span>
      </div>
      <div className="flex items-center gap-1">
        {TRACKING_INTERVAL_CHOICES.map((sec) => {
          const selected = intervalSec === sec;
          const busy = pending === sec;
          return (
            <button
              key={sec}
              type="button"
              onClick={() => handleClick(sec)}
              disabled={pending != null}
              className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                selected
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              } ${pending != null && !busy ? "opacity-50" : ""}`}
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {sec}s
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-1.5 text-[10px] text-red-600">{error}</p>
      )}
    </div>
  );
}
