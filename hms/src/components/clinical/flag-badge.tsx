import { ArrowDown, ArrowUp, OctagonAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Result/vital flag with icon AND text - never colour alone. */
export function FlagBadge({ flag }: { flag: string | undefined | null }) {
  switch (flag) {
    case "LOW":
      return (
        <Badge tone="warning" icon={<ArrowDown className="h-3 w-3" aria-hidden />}>
          Low
        </Badge>
      );
    case "HIGH":
      return (
        <Badge tone="warning" icon={<ArrowUp className="h-3 w-3" aria-hidden />}>
          High
        </Badge>
      );
    case "CRITICAL_LOW":
      return (
        <Badge tone="danger" icon={<OctagonAlert className="h-3 w-3" aria-hidden />}>
          Critically low
        </Badge>
      );
    case "CRITICAL_HIGH":
      return (
        <Badge tone="danger" icon={<OctagonAlert className="h-3 w-3" aria-hidden />}>
          Critically high
        </Badge>
      );
    case "ABNORMAL":
      return <Badge tone="warning">Abnormal</Badge>;
    case "NORMAL":
      return <Badge tone="neutral">In range</Badge>;
    default:
      return null;
  }
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  ORDERED: "Ordered",
  SCHEDULED: "Scheduled",
  SPECIMEN_COLLECTED: "Specimen collected",
  IN_PROGRESS: "In progress",
  RESULTED: "Awaiting verification",
  VERIFIED: "Result available",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
