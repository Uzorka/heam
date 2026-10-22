"use client";
import * as React from "react";
import Link from "next/link";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/table";

export interface PatientRow {
  id: string;
  mrn: string;
  name: string;
  sexAtBirth: string;
  age: string | null;
  maskedPhone: string;
  status: string;
  registrationStatus: string;
  lastVisit: string | null;
}

const SEX: Record<string, string> = { FEMALE: "F", MALE: "M", INTERSEX: "X", UNKNOWN: "-" };

export function PatientsTable({ rows, canOpen }: { rows: PatientRow[]; canOpen: boolean }) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const columns = React.useMemo<ColumnDef<PatientRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Patient",
        cell: ({ row }) => (
          <div className="min-w-[180px]">
            {canOpen ? (
              <Link prefetch={false} href={`/patients/${row.original.id}`} className="font-medium text-foreground hover:text-accent hover:underline">
                {row.original.name}
              </Link>
            ) : (
              <span className="font-medium">{row.original.name}</span>
            )}
            <div className="flex flex-wrap gap-1 pt-0.5">
              {row.original.registrationStatus === "PROVISIONAL" && <Badge tone="warning">Provisional</Badge>}
              {row.original.status === "DECEASED" && <Badge tone="neutral">Deceased</Badge>}
              {row.original.status === "INACTIVE" && <Badge tone="outline">Inactive</Badge>}
            </div>
          </div>
        ),
      },
      { accessorKey: "mrn", header: "MRN", cell: (c) => <span className="font-mono text-[13px]">{c.getValue<string>()}</span> },
      {
        id: "agesex",
        header: "Age / sex",
        accessorFn: (r) => r.age ?? "",
        cell: ({ row }) => (
          <span className="tabular">
            {row.original.age ?? "Age unknown"} · {SEX[row.original.sexAtBirth]}
          </span>
        ),
      },
      { accessorKey: "maskedPhone", header: "Phone", enableSorting: false, cell: (c) => <span className="tabular text-muted">{c.getValue<string>() || "-"}</span> },
      { accessorKey: "lastVisit", header: "Last visit", cell: (c) => <span className="text-muted">{c.getValue<string | null>() ?? "No visits"}</span> },
    ],
    [canOpen],
  );
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <TableWrap>
      <Table>
        <THead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <TH key={h.id} aria-sort={h.column.getIsSorted() ? (h.column.getIsSorted() === "asc" ? "ascending" : "descending") : undefined}>
                  {h.column.getCanSort() ? (
                    <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 uppercase">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <ArrowUpDown className="h-3 w-3" aria-hidden />
                    </button>
                  ) : (
                    flexRender(h.column.columnDef.header, h.getContext())
                  )}
                </TH>
              ))}
            </tr>
          ))}
        </THead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <TR key={r.id}>
              {r.getVisibleCells().map((c) => (
                <TD key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TD>
              ))}
            </TR>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
