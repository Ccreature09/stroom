import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  inventory,
  inventoryStatuses,
  items,
  locations,
} from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { Search } from "lucide-react";
import Link from "next/link";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ReceiveStockDialog, StockRowActions } from "./stock-controls";
const ROW_LIMIT = 500;

type SearchParams = Promise<{ q?: string; status?: string }>;

export default async function StockOnHandPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: SearchParams;
}) {
  const { warehouseId } = await params;
  const { q: query, status: statusFilter } = await searchParams;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireWarehouseAccess(warehouseId);

  const parsedStatusFilter = Number(statusFilter);
  const statusCondition =
    Number.isInteger(parsedStatusFilter) && parsedStatusFilter > 0
      ? eq(inventory.statusId, parsedStatusFilter)
      : undefined;

  const searchCondition = query
    ? or(
        ilike(items.sku, `%${query}%`),
        ilike(items.name, `%${query}%`),
        ilike(locations.locationCode, `%${query}%`),
        ilike(inventory.batchNumber, `%${query}%`),
        ilike(inventory.lotNumber, `%${query}%`),
      )
    : undefined;

  const whereCondition = and(
    eq(locations.warehouseId, parsedWarehouseId),
    searchCondition,
    statusCondition,
  );

  const [stockLines, statusOptions, itemOptions, locationOptions, [totals]] =
    await Promise.all([
      db
        .select({
          inventoryId: inventory.inventoryId,
          quantity: inventory.quantity,
          batchNumber: inventory.batchNumber,
          lotNumber: inventory.lotNumber,
          expiryDate: inventory.expiryDate,
          statusId: inventory.statusId,
          statusName: inventoryStatuses.name,
          locationId: inventory.locationId,
          locationCode: locations.locationCode,
          itemId: inventory.itemId,
          sku: items.sku,
          itemName: items.name,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.locationId))
        .leftJoin(items, eq(inventory.itemId, items.itemId))
        .leftJoin(
          inventoryStatuses,
          eq(inventory.statusId, inventoryStatuses.statusId),
        )
        .where(whereCondition)
        .orderBy(asc(locations.locationCode), asc(items.sku))
        .limit(ROW_LIMIT),
      db
        .select({
          statusId: inventoryStatuses.statusId,
          name: inventoryStatuses.name,
        })
        .from(inventoryStatuses)
        .where(eq(inventoryStatuses.organizationId, employee.organizationId))
        .orderBy(asc(inventoryStatuses.name)),
      db
        .select({
          itemId: items.itemId,
          sku: items.sku,
          name: items.name,
        })
        .from(items)
        .where(eq(items.organizationId, employee.organizationId))
        .orderBy(asc(items.sku)),
      db
        .select({
          locationId: locations.locationId,
          locationCode: locations.locationCode,
        })
        .from(locations)
        .where(
          and(
            eq(locations.warehouseId, parsedWarehouseId),
            eq(locations.isBlocked, false),
          ),
        )
        .orderBy(asc(locations.locationCode)),
      db
        .select({
          lines: sql<number>`count(*)::int`,
          units: sql<number>`coalesce(sum(${inventory.quantity}), 0)::int`,
        })
        .from(inventory)
        .innerJoin(locations, eq(inventory.locationId, locations.locationId))
        .where(whereCondition),
    ]);

  const canModify = employee.canModifyInventory === true;
  const truncated = stockLines.length === ROW_LIMIT;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Stock on Hand
          </h1>
          <p className="text-sm text-slate-500">
            Live inventory by location, item, batch, and lot.
          </p>
        </div>
        {canModify ? (
          <ReceiveStockDialog
            warehouseId={parsedWarehouseId}
            itemOptions={itemOptions}
            locationOptions={locationOptions}
            statusOptions={statusOptions}
          />
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Stock Lines
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {totals?.lines ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Units
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {totals?.units ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Statuses Defined
          </p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {statusOptions.length}
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={query || ""}
            placeholder="Search SKU, item, location, batch, or lot..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
          />
        </div>
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
        >
          <option value="">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status.statusId} value={status.statusId}>
              {status.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Apply
        </button>
      </form>

      {statusOptions.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No inventory statuses exist yet, so stock cannot be recorded.{" "}
          <Link
            href={`/warehouses/${parsedWarehouseId}/inventory/statuses`}
            className="font-semibold underline"
          >
            Set up statuses first
          </Link>
          .
        </div>
      ) : null}

      {itemOptions.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No items exist in the catalog yet.{" "}
          <Link
            href={`/warehouses/${parsedWarehouseId}/master-data/items`}
            className="font-semibold underline"
          >
            Add items first
          </Link>
          .
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Location</th>
              <th className="px-6 py-3">Item</th>
              <th className="px-6 py-3">Batch / Lot</th>
              <th className="px-6 py-3">Expiry</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Quantity</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {stockLines.map((line) => (
              <tr key={line.inventoryId} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-mono text-xs font-bold text-slate-900">
                  {line.locationCode}
                </td>
                <td className="px-6 py-4">
                  <div className="font-mono text-xs font-bold text-slate-900">
                    {line.sku ?? "-"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {line.itemName ?? "Unknown item"}
                  </div>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {line.batchNumber || line.lotNumber ? (
                    <>
                      <div>{line.batchNumber ?? "-"}</div>
                      <div className="text-slate-400">
                        {line.lotNumber ?? "-"}
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {line.expiryDate ?? "-"}
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 border border-slate-200">
                    {line.statusName ?? "Unassigned"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-mono text-sm font-semibold text-slate-900">
                  {line.quantity ?? 0}
                </td>
                <td className="px-6 py-4 text-right">
                  {canModify ? (
                    <StockRowActions
                      row={line}
                      warehouseId={parsedWarehouseId}
                      locationOptions={locationOptions}
                      statusOptions={statusOptions}
                    />
                  ) : (
                    <span className="text-xs text-slate-400">View only</span>
                  )}
                </td>
              </tr>
            ))}
            {stockLines.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-8 text-center text-slate-500"
                >
                  No stock found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {truncated ? (
        <p className="text-xs text-slate-500">
          Showing the first {ROW_LIMIT} lines. Narrow the search to see more.
        </p>
      ) : null}
    </main>
  );
}
