"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function Home() {
  const router = useRouter();
  const { managerAccount, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(managerAccount ? "/tracking" : "/login");
  }, [managerAccount, loading, router]);

  return null;
}
