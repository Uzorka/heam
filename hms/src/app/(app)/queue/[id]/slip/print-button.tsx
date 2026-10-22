"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer className="h-4 w-4" aria-hidden /> Print slip
    </Button>
  );
}
