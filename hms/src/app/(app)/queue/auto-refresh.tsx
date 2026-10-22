"use client";
import * as React from "react";
import { useRouter } from "next/navigation";

/** Safe polling: refreshes server data every `seconds` while the tab is visible. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [last, setLast] = React.useState(() => new Date());
  React.useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setLast(new Date());
      }
    };
    const id = setInterval(tick, seconds * 1000);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, seconds]);
  return (
    <p className="text-xs text-muted" aria-live="off">
      Updates every {seconds}s · last{" "}
      {last.toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Africa/Lagos",
      })}
    </p>
  );
}
