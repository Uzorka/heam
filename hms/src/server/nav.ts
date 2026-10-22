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
    label: "Clinical",
    items: [
      {
        href: "/queue?mine=1",
        label: "My patients",
        icon: "Stethoscope",
        any: ["clinical.note.write", "nursing.notes.write"],
      },
      { href: "/results", label: "Results to review", icon: "FileCheck2", any: ["clinical.results.review"] },
      { href: "/lab", label: "Laboratory", icon: "FlaskConical", any: ["lab.worklist"] },
      { href: "/imaging", label: "Imaging", icon: "ScanLine", any: ["imaging.worklist"] },
      { href: "/pharmacy", label: "Pharmacy", icon: "Pill", any: ["pharmacy.queue"] },
    ],
  },
  {
    label: "Wards & maternity",
    items: [
      { href: "/wards", label: "Ward board", icon: "BedDouble", any: ["admission.read"] },
      { href: "/maternity", label: "Maternity", icon: "Baby", any: ["maternity.read"] },
    ],
  },
  {
    label: "Stores",
    items: [
      { href: "/inventory", label: "Stock", icon: "Package", any: ["inventory.read"] },
      {
        href: "/inventory/procurement",
        label: "Procurement",
        icon: "Truck",
        any: [
          "inventory.requisition.create",
          "inventory.requisition.approve",
          "inventory.po.manage",
          "inventory.receive",
        ],
      },
      {
        href: "/inventory/approvals",
        label: "Stock approvals",
        icon: "ClipboardCheck",
        any: ["inventory.adjust", "inventory.adjust.approve", "inventory.count"],
      },
    ],
  },
  {
    label: "Billing & finance",
    items: [
      {
        href: "/billing",
        label: "Cashier desk",
        icon: "Wallet",
        any: ["billing.payment.collect", "billing.invoice.manage"],
      },
      {
        href: "/billing/approvals",
        label: "Billing approvals",
        icon: "ClipboardCheck",
        any: [
          "billing.discount.approve",
          "billing.refund.approve",
          "finance.close.approve",
          "billing.payment.collect",
        ],
      },
      {
        href: "/billing/catalogue",
        label: "Price list",
        icon: "Tags",
        any: ["billing.catalogue.manage", "billing.tariff.approve"],
      },
      { href: "/finance", label: "Finance overview", icon: "Landmark", any: ["finance.read"] },
    ],
  },
  {
    label: "HMO & insurance",
    items: [
      { href: "/hmo", label: "HMO desk", icon: "ShieldPlus", any: ["hmo.read"] },
      { href: "/hmo/preauth", label: "Pre-authorisations", icon: "FileClock", any: ["hmo.read"] },
      { href: "/hmo/claims", label: "Claims", icon: "FileStack", any: ["hmo.read"] },
      { href: "/hmo/remittances", label: "Remittances", icon: "Banknote", any: ["hmo.remittance.reconcile"] },
      { href: "/hmo/payers", label: "Payers & tariffs", icon: "Handshake", any: ["hmo.read"] },
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
      { href: "/admin/visit-types", label: "Visit types", icon: "CalendarCog", any: ["settings.read"] },
      {
        href: "/admin/clinical-catalogue",
        label: "Clinical catalogue",
        icon: "BookOpenCheck",
        any: ["lab.catalogue.manage", "clinical.rules.approve"],
      },
      {
        href: "/admin/medications",
        label: "Medication catalogue",
        icon: "Pill",
        any: ["pharmacy.catalogue.manage", "clinical.rules.approve"],
      },
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
