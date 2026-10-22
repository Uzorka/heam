import { canAny, type AuthContext } from "./authz/context";
import type { PermissionCode } from "./authz/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  any: PermissionCode[];
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navigation is assembled from effective permissions. Only implemented modules appear - no dead
 * links. Hiding a link is cosmetic; every route enforces its own permission on the server.
 */
const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", any: [] }],
  },
  {
    label: "Front desk",
    items: [
      { href: "/front-desk", label: "Today", icon: "ConciergeBell", any: ["queue.read"] },
      { href: "/patients", label: "Patients", icon: "Users", any: ["patient.search"] },
      { href: "/appointments", label: "Appointments", icon: "CalendarDays", any: ["appointment.read"] },
      { href: "/queue", label: "Visit queue", icon: "ListOrdered", any: ["queue.read"] },
      {
        href: "/patients/duplicates",
        label: "Duplicate review",
        icon: "Copy",
        any: ["patient.merge.request"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        href: "/admin/setup",
        label: "Setup checklist",
        icon: "ClipboardCheck",
        any: ["settings.read", "setup.verify"],
      },
      {
        href: "/admin/organization",
        label: "Hospital & branches",
        icon: "Building2",
        any: ["settings.read"],
      },
      { href: "/admin/facilities", label: "Departments & beds", icon: "BedDouble", any: ["settings.read"] },
      { href: "/admin/visit-types", label: "Visit types", icon: "Stethoscope", any: ["settings.read"] },
      {
        href: "/admin/settings",
        label: "System settings",
        icon: "SlidersHorizontal",
        any: ["settings.read"],
      },
      { href: "/admin/users", label: "Staff & access", icon: "UserCog", any: ["users.read"] },
      { href: "/admin/roles", label: "Roles & permissions", icon: "ShieldCheck", any: ["roles.read"] },
    ],
  },
  {
    label: "Audit & security",
    items: [
      { href: "/audit", label: "Audit trail", icon: "ScrollText", any: ["audit.read"] },
      {
        href: "/audit/break-glass",
        label: "Emergency access review",
        icon: "Siren",
        any: ["audit.breakglass.review"],
      },
    ],
  },
];

export function buildNav(ctx: AuthContext): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.any.length === 0 || canAny(ctx, i.any)),
  })).filter((g) => g.items.length > 0);
}
