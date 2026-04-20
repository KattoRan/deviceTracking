import Link from "next/link";
import { Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-7xl font-light text-slate-300">404</h1>
          <div className="mx-auto h-0.5 w-16 bg-slate-200" />
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl font-medium text-slate-800">
            Không tìm thấy trang
          </h2>
          <p className="text-slate-600">
            Đường dẫn bạn truy cập không tồn tại trong ứng dụng.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <Home className="h-4 w-4" />
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}
