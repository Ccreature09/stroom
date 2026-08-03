"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  FeatureKindDTO,
  HallDTO,
  LayoutVersionDTO,
} from "@/lib/warehouse-map/types";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type FeatureCategory,
} from "@/lib/warehouse-map/feature-kinds";
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
  type LocationType,
} from "@/lib/warehouse-map/naming";
import type { Tool } from "./layout-designer-canvas";
import { createHall, deleteHall } from "./actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Plus,
  Check,
  MousePointer,
  Hand,
  Move,
  SquarePlus,
  Blocks,
  Ruler,
  Trash2,
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";

// Purely presentational: which tool-switch buttons render in the segmented
// bar and their icon/label. "feature" and "draw" are deliberately absent --
// neither is a mode the user picks on its own any more; each is entered by
// choosing a kind/type from its Add menu beside these buttons.
const TOOL_BUTTONS: Array<{ id: Tool; label: string; icon: typeof MousePointer }> = [
  { id: "select", label: "Select", icon: MousePointer },
  { id: "pan", label: "Pan", icon: Hand },
  { id: "transform", label: "Move & Resize", icon: Move },
  { id: "measure", label: "Measure", icon: Ruler },
];

function groupKindsByCategory(kinds: FeatureKindDTO[]) {
  const groups = new Map<FeatureCategory, FeatureKindDTO[]>();
  for (const kind of kinds) {
    const existing = groups.get(kind.category) ?? [];
    existing.push(kind);
    groups.set(kind.category, existing);
  }
  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
    category,
    kinds: groups
      .get(category)!
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
  }));
}

/**
 * Add feature: one searchable list of every kind, grouped by category.
 * Picking a kind arms it and switches to the feature tool, so the next canvas
 * click drops it -- no separate "what is this shape?" step afterwards.
 *
 * This was a category menu with a hover-opened submenu per category, which
 * stacked every category's panel on top of the last on a hall with real
 * content on the canvas. Radix closes a hover-opened submenu from exactly one
 * place: `MenuSubContent` listens for `onFocusOutside`, and the only thing
 * that fires it is `MenuItemImpl`'s own `onPointerMove` calling
 * `item.focus()` as you sweep onto the next category. Nothing else in the
 * primitive closes it -- `onPointerLeave` only clears the open timer and sets
 * a grace-area polygon. So the moment that focus call stops landing, every
 * category you pass over opens and none of them ever close.
 *
 * A flat list removes the dependency on that choreography rather than trying
 * to out-guess it: no submenus, no hover-to-open, nothing to get stuck. It
 * also answers the actual question you have at this point -- you know the
 * feature is called "dock door", not which of six categories it lives under.
 */
function AddFeatureMenu({
  featureKinds,
  armedFeatureKind,
  onPickFeatureKind,
  active,
}: {
  featureKinds: FeatureKindDTO[];
  armedFeatureKind: FeatureKindDTO | null;
  onPickFeatureKind: (kind: FeatureKindDTO) => void;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const grouped = groupKindsByCategory(featureKinds);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "default" : "ghost"}
          size="sm"
          role="combobox"
          aria-expanded={open}
          className="shrink-0 justify-start text-xs font-medium"
          title="Add feature"
        >
          <Blocks className="mr-1.5 h-3.5 w-3.5" />
          {active && armedFeatureKind
            ? `Placing: ${armedFeatureKind.label}`
            : "Add feature"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-0 p-0">
        <Command>
          <CommandInput placeholder="Search features…" />
          <CommandList>
            <CommandEmpty>No feature matches that.</CommandEmpty>
            {grouped.map(({ category, kinds }) => (
              <CommandGroup key={category} heading={CATEGORY_LABELS[category]}>
                {kinds.map((kind) => (
                  <CommandItem
                    key={kind.kind}
                    // cmdk filters on this string, so the category label and
                    // the raw kind go in it too: "navigation" narrows to that
                    // whole group, and "DOCK_DOOR" finds it by column value.
                    value={`${kind.label} ${CATEGORY_LABELS[category]} ${kind.kind}`}
                    onSelect={() => {
                      onPickFeatureKind(kind);
                      setOpen(false);
                    }}
                  >
                    <span
                      className="mr-2 inline-block h-3 w-3 shrink-0 rounded-sm border border-black/10"
                      style={{ backgroundColor: kind.defaultColor }}
                    />
                    <span className="truncate">{kind.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Add location: a flat menu of the 4 location types (unlike feature kinds,
 * locations have no category grouping to nest under). Picking a type arms it
 * and switches to the draw tool, so the next canvas click drops one -- the
 * drag-a-box gesture this replaced made the size arbitrary and was easy to
 * fumble, exactly like the equivalent fix already made for features.
 */
function AddLocationMenu({
  armedLocationType,
  onPickLocationType,
  active,
}: {
  armedLocationType: LocationType | null;
  onPickLocationType: (type: LocationType) => void;
  active: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={active ? "default" : "ghost"}
          size="sm"
          className="shrink-0 justify-start text-xs font-medium"
          title="Add location"
        >
          <SquarePlus className="mr-1.5 h-3.5 w-3.5" />
          {active && armedLocationType
            ? `Placing: ${LOCATION_TYPE_LABELS[armedLocationType]}`
            : "Add location"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add location</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {LOCATION_TYPES.map((type) => (
            <DropdownMenuItem
              key={type}
              onSelect={() => onPickLocationType(type)}
            >
              {LOCATION_TYPE_LABELS[type]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function LayoutTopBar({
  warehouseId,
  halls,
  selectedHallId,
  onHallDeleted,
  tool,
  onToolChange,
  featureKinds,
  armedFeatureKind,
  onPickFeatureKind,
  armedLocationType,
  onPickLocationType,
  locked,
  onSaveMap,
  isSavingMap,
  pendingCount,
  currentVersionNumber,
  versionHistory,
  draftSaveState,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  warehouseId: number;
  halls: HallDTO[];
  selectedHallId: number;
  onHallDeleted: (hallId: number) => void;
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  featureKinds: FeatureKindDTO[];
  armedFeatureKind: FeatureKindDTO | null;
  onPickFeatureKind: (kind: FeatureKindDTO) => void;
  armedLocationType: LocationType | null;
  onPickLocationType: (type: LocationType) => void;
  locked: boolean;
  onSaveMap: () => void;
  isSavingMap: boolean;
  pendingCount: number;
  currentVersionNumber: number;
  versionHistory: LayoutVersionDTO[];
  draftSaveState: "idle" | "saving" | "saved" | "error";
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const router = useRouter();
  const [showNewHall, setShowNewHall] = useState(false);
  const [isDeletingHall, startDeleteHallTransition] = useTransition();
  const [deleteHallError, setDeleteHallError] = useState<string>();
  const [savedMessage, setSavedMessage] = useState(false);
  const wasSavingRef = useRef(false);

  useEffect(() => {
    if (wasSavingRef.current && !isSavingMap) {
      setSavedMessage(true);
      const timeout = setTimeout(() => setSavedMessage(false), 2000);
      return () => clearTimeout(timeout);
    }
    wasSavingRef.current = isSavingMap;
  }, [isSavingMap]);

  const selectedHall =
    halls.find((h) => h.hallId === selectedHallId) ?? halls[0];

  function handleDeleteHall() {
    if (
      !confirm(
        `Delete hall "${selectedHall.name}"? This also removes its zones, features, nav graph, routes, and blueprint underlay, and cannot be undone.`,
      )
    )
      return;
    setDeleteHallError(undefined);
    startDeleteHallTransition(async () => {
      const result = await deleteHall(warehouseId, selectedHall.hallId);
      if (result?.error) {
        setDeleteHallError(result.error);
        return;
      }
      onHallDeleted(selectedHall.hallId);
    });
  }

  return (
    <div className="sticky top-0 z-30 border-b bg-background/80 shadow-sm backdrop-blur-md">
      <fieldset
        disabled={locked}
        className="m-0 flex min-w-0 items-center gap-2 border-0 px-3 py-2"
      >
        {/* Fixed left segment: sidebar toggle + hall navigation -- always
            visible, never scrolls away. */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={sidebarCollapsed ? "Show panel" : "Hide panel"}
            onClick={onToggleSidebar}
          >
            {sidebarCollapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>

          <Separator orientation="vertical" className="h-6" />

          <div className="relative flex items-center gap-1">
            <Select
              value={String(selectedHallId)}
              onValueChange={(val) =>
                router.push(
                  `/warehouses/${warehouseId}/layout-designer?hall=${val}`,
                )
              }
            >
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder="Select hall" />
              </SelectTrigger>
              <SelectContent>
                {halls.map((h) => (
                  <SelectItem key={h.hallId} value={String(h.hallId)}>
                    {h.name}
                    {h.isActive === false ? " (inactive)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="New hall"
              onClick={() => setShowNewHall(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              title="Delete hall"
              disabled={isDeletingHall}
              onClick={handleDeleteHall}
            >
              <Trash2 className="h-4 w-4" />
            </Button>

            {deleteHallError && (
              <Alert
                variant="destructive"
                className="absolute right-0 top-full z-40 mt-1 w-64 py-2 text-xs shadow-md"
              >
                <AlertDescription>{deleteHallError}</AlertDescription>
              </Alert>
            )}
          </div>
        </div>

        <Separator orientation="vertical" className="h-6 shrink-0" />

        {/* Scrollable middle segment: drawing tools. Degrades to horizontal
            scroll instead of clipping on narrow viewports. */}
        <div className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
          <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1">
            {TOOL_BUTTONS.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={tool === id ? "default" : "ghost"}
                size="sm"
                onClick={() => onToolChange(id)}
                className="shrink-0 justify-start text-xs font-medium"
                title={label}
              >
                <Icon className="mr-1.5 h-3.5 w-3.5" />
                {label}
              </Button>
            ))}
            <AddLocationMenu
              armedLocationType={armedLocationType}
              onPickLocationType={onPickLocationType}
              active={tool === "draw"}
            />
            <AddFeatureMenu
              featureKinds={featureKinds}
              armedFeatureKind={armedFeatureKind}
              onPickFeatureKind={onPickFeatureKind}
              active={tool === "feature"}
            />
          </div>
        </div>

        <Separator orientation="vertical" className="h-6 shrink-0" />

        {/* Fixed right segment: version/publish status + Save Map. */}
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden flex-col items-end leading-tight sm:flex">
            <span
              className="text-[11px] text-muted-foreground"
              title={
                versionHistory[0]?.publishedAt
                  ? `Published ${new Date(versionHistory[0].publishedAt).toLocaleString()}${
                      versionHistory[0].publishedByName
                        ? ` by ${versionHistory[0].publishedByName}`
                        : ""
                    }`
                  : "This layout has never been published."
              }
            >
              {currentVersionNumber > 0
                ? `Layout v${currentVersionNumber}`
                : "Unpublished layout"}
            </span>
            {/* Autosave is about the *draft*, not the published layout. */}
            <span
              className={
                draftSaveState === "error"
                  ? "text-[11px] font-medium text-destructive"
                  : "text-[11px] text-muted-foreground"
              }
            >
              {draftSaveState === "saving" && "Saving draft…"}
              {draftSaveState === "saved" && "Draft saved"}
              {draftSaveState === "error" && "Draft not synced"}
              {draftSaveState === "idle" && " "}
            </span>
          </div>

          <Button
            onClick={onSaveMap}
            disabled={isSavingMap || pendingCount === 0}
            size="sm"
            className="text-xs font-semibold"
          >
            {isSavingMap ? (
              "Saving..."
            ) : savedMessage ? (
              <span className="flex items-center gap-1">
                <Check className="h-4 w-4" /> Map Saved!
              </span>
            ) : pendingCount > 0 ? (
              `Save Map (${pendingCount})`
            ) : (
              "Save Map"
            )}
          </Button>
        </div>
      </fieldset>

      {showNewHall && (
        <NewHallDialog
          warehouseId={warehouseId}
          open={showNewHall}
          onOpenChange={setShowNewHall}
        />
      )}
    </div>
  );
}

function NewHallDialog({
  warehouseId,
  open,
  onOpenChange,
}: {
  warehouseId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">New hall</DialogTitle>
        </DialogHeader>
        <form action={createHall} className="space-y-3 pt-2">
          <input type="hidden" name="warehouseId" value={warehouseId} />
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              placeholder="Hall B - Cold Storage"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="physicalWidthMm">Width (mm)</Label>
              <Input
                id="physicalWidthMm"
                name="physicalWidthMm"
                type="number"
                min={1}
                defaultValue={80_000}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="physicalLengthMm">Length (mm)</Label>
              <Input
                id="physicalLengthMm"
                name="physicalLengthMm"
                type="number"
                min={1}
                defaultValue={60_000}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="clearHeightMm">Clear height (mm)</Label>
            <Input
              id="clearHeightMm"
              name="clearHeightMm"
              type="number"
              min={1}
              defaultValue={12_000}
            />
          </div>
          <Button type="submit" className="w-full pt-2">
            Create hall
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
