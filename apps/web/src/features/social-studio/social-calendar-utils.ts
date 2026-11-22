import React from "react";
import type { EditorialPostFormato, EditorialPostStatus } from "@criativo/contracts";
import { Film, Image as ImageIcon, Layers, Smartphone } from "lucide-react";

export const FORMAT_META: Record<
  EditorialPostFormato,
  { label: string; colorClass: string; Icon: React.FC<{ className?: string }> }
> = {
  feed_4_5: { label: "Feed 4:5", colorClass: "text-[#42A0FF] bg-[#42A0FF]/15", Icon: ImageIcon },
  carrossel: { label: "Carrossel", colorClass: "text-[#31CF76] bg-[#31CF76]/15", Icon: Layers },
  reels: { label: "Reels", colorClass: "text-[#D97757] bg-[#D97757]/15", Icon: Film },
  story: { label: "Story", colorClass: "text-[#FDCB6E] bg-[#FDCB6E]/15", Icon: Smartphone },
};

export const STATUS_META: Record<EditorialPostStatus, { label: string; badgeClass: string }> = {
  ideia: { label: "Ideia", badgeClass: "bg-white/10 text-[#DCDCDC]" },
  rascunho: { label: "Rascunho", badgeClass: "bg-[#42A0FF]/15 text-[#42A0FF]" },
  em_producao: { label: "Em produção", badgeClass: "bg-[#FF9412]/15 text-[#FF9412]" },
  aprovacao: { label: "Aprovação", badgeClass: "bg-[#A38BFF]/20 text-[#C4B5FD]" },
  agendado: { label: "Agendado", badgeClass: "bg-[#31CF76]/15 text-[#31CF76]" },
  publicado: { label: "Publicado", badgeClass: "bg-[#31CF76]/25 text-[#6EE7B7]" },
};

export const WEEK_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function toYearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getMondayOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

export function buildMonthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = getMondayOfWeek(first);
  const days: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push(d);
  }
  return days;
}
