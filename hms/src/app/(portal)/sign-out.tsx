"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { logoutAction } from "@/app/(auth)/actions";

export function PortalSignOut() {
  const [pending, start] = React.useTransition();
  return (
    <Button variant="ghost" size="sm" loading={pending} onClick={() => start(() => logoutAction())}>
      Sign out
    </Button>
  );
}
