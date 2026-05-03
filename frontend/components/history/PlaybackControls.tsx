"use client";

import {
  ChevronsLeft,
  ChevronsRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { HistoryPoint } from "@/types/device";

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8];

interface PlaybackControlsProps {
  points: HistoryPoint[];
  currentIndex: number;
  setCurrentIndex: (i: number) => void;
  isPlaying: boolean;
  setIsPlaying: (v: boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
}

export default function PlaybackControls({
  points,
  currentIndex,
  setCurrentIndex,
  isPlaying,
  setIsPlaying,
  speed,
  setSpeed,
}: PlaybackControlsProps) {
  const total = points.length;
  const current = points[currentIndex];

  if (total === 0) return null;

  const togglePlay = () => {
    if (currentIndex >= total - 1 && !isPlaying) {
      setCurrentIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const stepBack = () => {
    setIsPlaying(false);
    setCurrentIndex(Math.max(0, currentIndex - 1));
  };

  const stepForward = () => {
    setIsPlaying(false);
    setCurrentIndex(Math.min(total - 1, currentIndex + 1));
  };

  const goToStart = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
  };

  const goToEnd = () => {
    setIsPlaying(false);
    setCurrentIndex(total - 1);
  };

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(speed);
    setSpeed(SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]);
  };

  return (
    <div className="bg-white border-t border-slate-200">
      <div className="px-4 pt-3">
        <input
          type="range"
          min={0}
          max={total - 1}
          value={currentIndex}
          onChange={(e) => {
            setIsPlaying(false);
            setCurrentIndex(Number(e.target.value));
          }}
          className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:bg-emerald-600 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-grab
            [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(16,185,129,0.2)]"
        />
      </div>

      <div className="flex items-center justify-between px-4 py-2">
        <div className="text-xs text-slate-500 min-w-[140px]">
          {current && (
            <span className="text-slate-900 font-mono font-medium">
              {new Date(current.time).toLocaleTimeString("vi-VN")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <ControlBtn onClick={goToStart} title="Về đầu">
            <ChevronsLeft className="w-4 h-4" />
          </ControlBtn>
          <ControlBtn onClick={stepBack} title="Lùi 1 bước">
            <SkipBack className="w-4 h-4" />
          </ControlBtn>

          <button
            type="button"
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center transition-colors shadow-sm"
            title={isPlaying ? "Tạm dừng" : "Phát"}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" />
            )}
          </button>

          <ControlBtn onClick={stepForward} title="Tiến 1 bước">
            <SkipForward className="w-4 h-4" />
          </ControlBtn>
          <ControlBtn onClick={goToEnd} title="Về cuối">
            <ChevronsRight className="w-4 h-4" />
          </ControlBtn>
        </div>

        <div className="flex items-center gap-3 min-w-[140px] justify-end">
          <button
            type="button"
            onClick={cycleSpeed}
            className="text-xs font-mono px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors"
            title="Thay đổi tốc độ"
          >
            {speed}x
          </button>
          <span className="text-xs text-slate-500 font-mono">
            {currentIndex + 1}/{total}
          </span>
        </div>
      </div>
    </div>
  );
}

function ControlBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
    >
      {children}
    </button>
  );
}
