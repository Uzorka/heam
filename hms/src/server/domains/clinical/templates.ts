import type { ClinicalNoteType } from "@prisma/client";
import type { NoteSection } from "@/lib/schemas/clinical";

/**
 * Default note structures. These are layout only (headings), not clinical rules. Hospital-specific
 * templates must be approved by the medical director before being added here or made configurable.
 */
export const SECTION_LABELS: Record<NoteSection, string> = {
  chiefComplaint: "Presenting complaint",
  history: "History of presenting complaint",
  reviewOfSystems: "Review of systems",
  examination: "Examination",
  assessment: "Assessment",
  plan: "Plan",
  returnPrecautions: "Return precautions / advice given",
  body: "Note",
};

export const NOTE_TEMPLATES: Record<Exclude<ClinicalNoteType, "ADDENDUM">, { label: string; sections: NoteSection[] }> = {
  CONSULTATION: {
    label: "Consultation (SOAP)",
    sections: ["chiefComplaint", "history", "reviewOfSystems", "examination", "assessment", "plan", "returnPrecautions"],
  },
  PROGRESS: { label: "Progress note", sections: ["assessment", "plan"] },
  NURSING: { label: "Nursing note", sections: ["body"] },
  PROCEDURE: { label: "Procedure note", sections: ["body"] },
};

export function sectionsFor(type: ClinicalNoteType): NoteSection[] {
  return type === "ADDENDUM" ? ["body"] : NOTE_TEMPLATES[type].sections;
}
