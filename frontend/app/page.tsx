"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function Home() {
  const router = useRouter();
  const { parentAccount, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(parentAccount ? "/tracking" : "/login");
  }, [parentAccount, loading, router]);

  return null;
}
