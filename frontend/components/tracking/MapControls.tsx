"use client";

import {
  GitBranch,
  Radio,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MapControlsProps {
  showBts: boolean;
  onToggleBts: () => void;
  showBtsLines: boolean;
  onToggleBtsLines: () => void;
  showGeofences: boolean;
  onToggleGeofences: () => void;
}

export default function MapControls({
  showBts,
  onToggleBts,
  showBtsLines,
  onToggleBtsLines,
  showGeofences,
  onToggleGeofences,
}: MapControlsProps) {
  return (
    <div className="absolute bottom-10 left-4 z-[1000] flex flex-col gap-2 max-md:bottom-20 max-md:left-auto max-md:right-4">
      <ControlBtn
        icon={Radio}
        label="Trạm BTS"
        active={showBts}
        onClick={onToggleBts}
        activeColor="text-indigo-700"
        activeBg="bg-indigo-50 border-indigo-300"
      />
      <ControlBtn
        icon={GitBranch}
        label="Đường kết nối BTS"
        active={showBtsLines}
        onClick={onToggleBtsLines}
        activeColor="text-sky-700"
        activeBg="bg-sky-50 border-sky-300"
      />
      <ControlBtn
        icon={Shield}
        label="Vùng giám sát"
        active={showGeofences}
        onClick={onToggleGeofences}
        activeColor="text-emerald-700"
        activeBg="bg-emerald-50 border-emerald-300"
      />
    </div>
  );
}

interface ControlBtnProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  activeColor: string;
  activeBg: string;
}

function ControlBtn({
  icon: Icon,
  label,
  active,
  onClick,
  activeColor,
  activeBg,
}: ControlBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium shadow-sm transition-all",
        active
          ? `${activeBg} ${activeColor}`
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
