export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex items-center gap-3 text-sm text-slate-500">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
        Đang tải…
      </div>
    </div>
  );
}
