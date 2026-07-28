import Link from "next/link";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventory,
  inventoryStatuses,
  locations,
  pallets,
  stockMovements,
} from "@/drizzle/schema";
import { alias } from "drizzle-orm/pg-core";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";

export default async function InventoryControlPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const {
    employee,
    warehouse,
    warehouseId: parsedWarehouseId,
  } = await requireWarehouseAccess(warehouseId);

  const movementSourceLocations = alias(locations, "movement_source_locations");
  const movementDestinationLocations = alias(
    locations,
    "movement_destination_locations",
  );

  const [[stockTotals], [palletTotals], [movementTotals], [statusTotals]] =
    await Promise.all([
      db
        .select({
          lines: sql<number>`count(*)::int`,
          units: sql<number>`coalesce(sum(${inventory.quantity}), 0)::int`,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.locationId))
        .where(eq(locations.warehouseId, parsedWarehouseId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pallets)
        .where(eq(pallets.warehouseId, parsedWarehouseId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(stockMovements)
        .leftJoin(
          movementSourceLocations,
          eq(
            stockMovements.sourceLocationId,
            movementSourceLocations.locationId,
          ),
        )
        .leftJoin(
          movementDestinationLocations,
          eq(
            stockMovements.destinationLocationId,
            movementDestinationLocations.locationId,
          ),
        )
        .where(
          or(
            eq(movementSourceLocations.warehouseId, parsedWarehouseId),
            eq(movementDestinationLocations.warehouseId, parsedWarehouseId),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryStatuses)
        .where(eq(inventoryStatuses.organizationId, employee.organizationId)),
    ]);

  const [locationTotals] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(locations)
    .where(
      and(
        eq(locations.warehouseId, parsedWarehouseId),
        eq(locations.isBlocked, false),
      ),
    );

  const cards = [
    {
      href: `/warehouses/${parsedWarehouseId}/inventory/stock`,
      title: "Stock on Hand",
      description:
        "Live quantities by location, item, batch, and lot. Receive, adjust, and move stock.",
      cta: "View Stock →",
      metric: `${stockTotals?.units ?? 0} units · ${stockTotals?.lines ?? 0} lines`,
    },
    {
      href: `/warehouses/${parsedWarehouseId}/inventory/pallets`,
      title: "Pallets (LPNs)",
      description:
        "License plate numbers tracking physical pallets and where they currently sit.",
      cta: "View Pallets →",
      metric: `${palletTotals?.count ?? 0} registered`,
    },
    {
      href: `/warehouses/${parsedWarehouseId}/inventory/movements`,
      title: "Stock Movements",
      description:
        "Immutable audit trail of every receipt, adjustment, and transfer.",
      cta: "View Movements →",
      metric: `${movementTotals?.count ?? 0} recorded`,
    },
    {
      href: `/warehouses/${parsedWarehouseId}/inventory/statuses`,
      title: "Inventory Statuses",
      description:
        "Define whether stock in each status can be allocated, moved, or sold.",
      cta: "Manage Statuses →",
      metric: `${statusTotals?.count ?? 0} defined`,
    },
  ];

  return (
    <main className="flex-1 bg-slate-50 px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <Card className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <CardHeader className="px-6 py-6 sm:px-8">
            <DynamicBreadcrumb />
            <CardTitle className="mt-3 text-3xl font-bold tracking-[-0.04em] text-slate-950">
              Inventory Control
            </CardTitle>
            <CardDescription className="mt-2 text-sm text-slate-600">
              Stock ledger, pallet tracking, and movement history for{" "}
              <span className="font-semibold text-slate-800">
                {warehouse.name}
              </span>
              .
            </CardDescription>
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">
              {locationTotals?.count ?? 0} usable locations ·{" "}
              {employee.canModifyInventory === true
                ? "Write access"
                : "Read-only access"}
            </p>
          </CardHeader>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group block focus:outline-none"
            >
              <Card className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
                <CardHeader className="p-6">
                  <CardTitle className="text-lg font-bold text-slate-950">
                    {card.title}
                  </CardTitle>
                  <CardDescription className="mt-2 text-sm text-slate-600">
                    {card.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-6 pb-6 pt-0">
                  <p className="mb-3 font-mono text-xs font-semibold text-slate-500">
                    {card.metric}
                  </p>
                  <span className="inline-flex text-sm font-semibold text-teal-700 transition-colors group-hover:text-teal-800">
                    {card.cta}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
