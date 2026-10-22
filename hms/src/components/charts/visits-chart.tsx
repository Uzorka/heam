"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function VisitsChart({ data }: { data: { day: string; visits: number }[] }) {
  return (
    <div className="h-56 w-full" aria-hidden>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8)} tick={{ fontSize: 11, fill: "hsl(var(--muted))" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted))" }} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "hsl(var(--surface-2))" }}
            contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
          />
          <Bar dataKey="visits" name="Visits" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
