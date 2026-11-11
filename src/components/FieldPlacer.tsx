import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Minus, Plus, Trash2, PenLine, Type, CalendarDays, ALargeSmall } from "lucide-react";
import { FIELD_COLORS, FIELD_LABELS, type FieldPlacement, type FieldType } from "@/lib/docuall-types";
import { cn } from "@/lib/utils";
import { ZoomFrame } from "@/components/ZoomFrame";

const TYPE_ICONS: Record<FieldType, typeof PenLine> = {
  signature: PenLine,
  initials: ALargeSmall,
  date: CalendarDays,
  text: Type,
};

/**
 * Drag-and-drop field placement over document pages. Fields are positioned in
 * page-fraction coordinates (top-left anchored), same as the original app.
 */
export function FieldPlacer({
  pages,
  fields,
  onChange,
  renderSelectedExtra,
}: {
  pages: string[];
  fields: FieldPlacement[];
  onChange: (fields: FieldPlacement[]) => void;
  /** Extra controls for the selected-field panel (e.g. a signature picker). */
  renderSelectedExtra?: (field: FieldPlacement, update: (patch: Partial<FieldPlacement>) => void) => React.ReactNode;
}) {
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<FieldType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const tapStart = useRef<{ x: number; y: number } | null>(null);

  const pageFields = fields.filter((f) => f.page_index === pageIndex);
  const selected = fields.find((f) => f.id === selectedId) ?? null;

  const addField = (type: FieldType, x = 0.3, y = 0.4) => {
    const field: FieldPlacement = {
      id: crypto.randomUUID(),
      type,
      page_index: pageIndex,
      x: Math.min(0.9, Math.max(0, x)),
      y: Math.min(0.95, Math.max(0, y)),
      w: type === "signature" ? 0.35 : type === "initials" ? 0.18 : 0.03,
      text: type === "date" ? new Date().toLocaleDateString("en-US") : type === "text" ? "" : undefined,
    };
    onChange([...fields, field]);
    setSelectedId(field.id);
  };

  const updateField = (id: string, patch: Partial<FieldPlacement>) => {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeField = (id: string) => {
    onChange(fields.filter((f) => f.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const onPointerDown = (e: React.PointerEvent, field: FieldPlacement) => {
    e.stopPropagation();
    setSelectedId(field.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { id: field.id, startX: e.clientX, startY: e.clientY, origX: field.x, origY: field.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragState.current;
    const container = containerRef.current;
    if (!drag || !container) return;
    // Bounding rect reflects the current zoom, so fractions stay accurate.
    const rect = container.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    updateField(drag.id, {
      x: Math.min(0.95, Math.max(0, drag.origX + dx)),
      y: Math.min(0.95, Math.max(0, drag.origY + dy)),
    });
  };

  const onPointerUp = () => {
    dragState.current = null;
  };

  const onPagePointerDown = (e: React.PointerEvent) => {
    tapStart.current = { x: e.clientX, y: e.clientY };
  };

  const onPageClick = (e: React.MouseEvent) => {
    const start = tapStart.current;
    tapStart.current = null;
    // Ignore taps that were really pans/pinches.
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
    if (armed && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      addField(armed, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height - 0.01);
      setArmed(null);
    } else {
      setSelectedId(null);
    }
  };

  const resize = (id: string, dir: 1 | -1) => {
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    const step = f.type === "signature" || f.type === "initials" ? 0.03 : 0.005;
    const min = f.type === "signature" || f.type === "initials" ? 0.08 : 0.015;
    const max = f.type === "signature" || f.type === "initials" ? 0.9 : 0.12;
    updateField(id, { w: Math.min(max, Math.max(min, f.w + dir * step)) });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {(Object.keys(FIELD_LABELS) as FieldType[]).map((type) => {
          const Icon = TYPE_ICONS[type];
          return (
            <Button
              key={type}
              type="button"
              variant={armed === type ? "default" : "secondary"}
              size="sm"
              onClick={() => setArmed(armed === type ? null : type)}
              className="flex-col h-auto min-h-12 py-2 gap-1"
            >
              <Icon className="h-4 w-4" style={{ color: armed === type ? undefined : FIELD_COLORS[type] }} />
              <span className="text-[11px]">{type === "text" ? "Text box" : FIELD_LABELS[type]}</span>
            </Button>
          );
        })}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {armed
          ? `Tap anywhere on the page to drop a ${armed === "text" ? "text box" : FIELD_LABELS[armed].toLowerCase()}.`
          : "Pick a field, then tap where it goes. Pinch or double-tap to zoom."}
      </p>

      {pages.length > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}>
            Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {pages.length}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pageIndex >= pages.length - 1}
            onClick={() => setPageIndex(pageIndex + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <ZoomFrame key={pageIndex} className="overflow-hidden rounded-xl border border-border bg-white">
      <div
        ref={containerRef}
        className={cn("relative w-full select-none bg-white", armed && "cursor-crosshair")}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerDown={onPagePointerDown}
        onClick={onPageClick}
      >
        {pages[pageIndex] && <img src={pages[pageIndex]} alt={`Page ${pageIndex + 1}`} className="block w-full" draggable={false} />}

        {pageFields.map((f) => {
          const isImage = f.type === "signature" || f.type === "initials";
          const style: React.CSSProperties = {
            left: `${f.x * 100}%`,
            top: `${f.y * 100}%`,
            width: isImage ? `${f.w * 100}%` : undefined,
            fontSize: isImage ? undefined : `${f.w * 100}cqh`,
          };
          return (
            <div
              key={f.id}
              onPointerDown={(e) => onPointerDown(e, f)}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "zoom-exclude absolute flex touch-none cursor-move items-center justify-center rounded border-2 border-dashed px-1",
                selectedId === f.id ? "border-primary bg-primary/20" : "bg-primary/10",
              )}
              style={{ ...style, borderColor: selectedId === f.id ? undefined : FIELD_COLORS[f.type], minHeight: 28, minWidth: isImage ? undefined : 48, containerType: "size" }}
            >
              <span className="zoom-exclude pointer-events-none truncate text-[10px] font-semibold" style={{ color: FIELD_COLORS[f.type] }}>
                {f.type === "date" || f.type === "text" ? f.text || FIELD_LABELS[f.type] : f.label || FIELD_LABELS[f.type]}
              </span>
            </div>
          );
        })}
      </div>
      </ZoomFrame>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          <span className="text-sm font-medium text-foreground">{FIELD_LABELS[selected.type]}</span>
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => resize(selected.id, -1)}>
              <Minus className="h-3 w-3" />
            </Button>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => resize(selected.id, 1)}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          {(selected.type === "text" || selected.type === "date") && (
            <Input
              className="h-8 flex-1 min-w-32"
              value={selected.text ?? ""}
              placeholder={selected.type === "date" ? "Date" : "Text"}
              onChange={(e) => updateField(selected.id, { text: e.target.value })}
            />
          )}
          {selected.type !== "text" && selected.type !== "date" && (
            <Input
              className="h-8 flex-1 min-w-32"
              value={selected.label ?? ""}
              placeholder="Label (optional)"
              onChange={(e) => updateField(selected.id, { label: e.target.value })}
            />
          )}
          {renderSelectedExtra?.(selected, (patch) => updateField(selected.id, patch))}
          <Button type="button" variant="destructive" size="icon" className="h-8 w-8" onClick={() => removeField(selected.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
