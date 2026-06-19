"use client";

import { Loader2, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  autocompletePlace,
  placeDetail,
  type PlacePrediction,
} from "@/lib/goong";

interface AddressSearchProps {
  /** Vị trí bias autocomplete (vd center map hiện tại) — gợi ý gần hơn. */
  bias?: { lat: number; lon: number };
  /** Callback khi user pick 1 suggestion. Component reset query sau đó. */
  onPick: (place: { lat: number; lon: number; description: string }) => void;
  placeholder?: string;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export default function AddressSearch({
  bias,
  onPick,
  placeholder = "Tìm địa chỉ, địa danh...",
}: AddressSearchProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce + fetch autocomplete. Mọi request đang chạy được abort khi user
  // gõ tiếp — tránh kết quả cũ override kết quả mới.
  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setLoading(false);
      setError(null);
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      autocompletePlace(query, { location: bias, signal: controller.signal })
        .then((preds) => {
          if (controller.signal.aborted) return;
          setSuggestions(preds);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : "Tìm địa chỉ thất bại");
          setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, bias]);

  // Click outside → close dropdown
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function handlePick(pred: PlacePrediction) {
    try {
      const detail = await placeDetail(pred.placeId);
      onPick({
        lat: detail.lat,
        lon: detail.lon,
        description: detail.description || pred.description,
      });
      setQuery("");
      setSuggestions([]);
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Không lấy được toạ độ địa chỉ",
      );
    }
  }

  function clear() {
    setQuery("");
    setSuggestions([]);
    setError(null);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
        )}
        {!loading && query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Xoá"
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (query.trim().length >= MIN_QUERY_LENGTH || error) && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {error && (
            <div className="px-3 py-3 text-xs text-red-600">{error}</div>
          )}
          {!error && !loading && suggestions.length === 0 && (
            <div className="px-3 py-3 text-center text-xs text-slate-500">
              Không tìm thấy địa chỉ phù hợp
            </div>
          )}
          {!error && suggestions.length > 0 && (
            <ul>
              {suggestions.map((s) => (
                <li key={s.placeId}>
                  <button
                    type="button"
                    onClick={() => handlePick(s)}
                    className="flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-emerald-50"
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-900">
                        {s.mainText}
                      </div>
                      {s.secondaryText && (
                        <div className="truncate text-xs text-slate-500">
                          {s.secondaryText}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
