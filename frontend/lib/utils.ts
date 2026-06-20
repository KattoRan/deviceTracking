import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Lightweight "X phút trước" / "Y giờ trước" cho UI tiếng Việt. Không kéo
 * `date-fns` vì chỉ dùng vài chỗ — bundle size tốt hơn.
 */
export function formatDistanceToNow(date: Date): string {
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} ngày trước`;
  return date.toLocaleDateString("vi-VN");
}

/**
 * Format quãng thời gian (ms) → "Xh Ym" / "X phút". Dùng cho history
 * summary, dwell time, etc.
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0 phút";
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin} phút`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} giờ` : `${h}h ${m}m`;
}

/**
 * Format quãng đường (m) → "X m" hoặc "Y.YY km". Null/0 → "--".
 */
export function formatDistance(m: number | null | undefined): string {
  if (m == null) return "--";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/**
 * Format ISO datetime → "dd/MM/yyyy HH:mm" Việt Nam locale. Null → "--".
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format toạ độ (lat/lon) đến 6 chữ số thập phân (~11cm precision tại
 * xích đạo). Null → "--".
 */
export function formatCoord(val: number | null | undefined): string {
  return val == null ? "--" : val.toFixed(6);
}
