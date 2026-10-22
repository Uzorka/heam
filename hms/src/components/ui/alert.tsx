import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const tones = {
  info: { cls: "border-info/25 bg-info-soft text-foreground", icon: Info, iconCls: "text-info", label: "Information" },
  success: { cls: "border-success/25 bg-success-soft text-foreground", icon: CheckCircle2, iconCls: "text-success", label: "Success" },
  warning: { cls: "border-warning/30 bg-warning-soft text-foreground", icon: AlertTriangle, iconCls: "text-warning", label: "Warning" },
  danger: { cls: "border-danger/30 bg-danger-soft text-foreground", icon: OctagonAlert, iconCls: "text-danger", label: "Alert" },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  role,
}: {
  tone?: keyof typeof tones;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn("flex gap-3 rounded-md border p-3.5 text-sm", t.cls, className)}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.iconCls)} aria-hidden />
      <div className="min-w-0">
        <span className="sr-only">{t.label}: </span>
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-[13px] leading-5")}>{children}</div>}
      </div>
    </div>
  );
}
