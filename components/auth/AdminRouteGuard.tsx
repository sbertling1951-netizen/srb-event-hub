"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function AdminRouteGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    async function checkUser() {
      const { data } = await supabase.auth.getUser();

      if (data?.user) {
        setAllowed(true);
      } else {
        setAllowed(false);
      }

      setLoading(false);
    }

    void checkUser();
  }, []);

  if (loading) {
    return <div style={{ padding: 20 }}>Checking access...</div>;
  }

  if (!allowed) {
    return <div style={{ padding: 20 }}>Access denied</div>;
  }

  return <>{children}</>;
}
