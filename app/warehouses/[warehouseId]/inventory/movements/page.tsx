import { and, desc, eq, ilike, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { employees, items, locations, stockMovements } from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { ArrowRight, Search } from "lucide-react";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";

const ROW_LIMIT = 500;

const MOVEMENT_TYPES = [
  "RECEIPT",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "TRANSFER",
] as const;

const typeStyles: Record<string, string> = {
  RECEIPT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ADJUSTMENT_IN: "bg-blue-50 text-blue-700 border-blue-200",
  ADJUSTMENT_OUT: "bg-amber-50 text-amber-700 border-amber-200",
  TRANSFER: "bg-purple-50 text-purple-700 border-purple-200",
};

type SearchParams = Promise<{ q?: string; type?: string }>;

export default async function StockMovementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: SearchParams;
}) {
  const { warehouseId } = await params;
  const { q: query, type: typeFilter } = await searchParams;
  const { warehouseId: parsedWarehouseId } =
    await requireWarehouseAccess(warehouseId);

  // A movement touches at most two locations and either may be null (a receipt
  // has no source, a write-off has no destination), so the warehouse filter has
  // to match on either side.
  const sourceLocations = alias(locations, "source_locations");
  const destinationLocations = alias(locations, "destination_locations");

  const warehouseCondition = or(
    eq(sourceLocations.warehouseId, parsedWarehouseId),
    eq(destinationLocations.warehouseId, parsedWarehouseId),
  );

  const searchCondition = query
    ? or(
        ilike(items.sku, `%${query}%`),
        ilike(items.name, `%${query}%`),
        ilike(sourceLocations.locationCode, `%${query}%`),
        ilike(destinationLocations.locationCode, `%${query}%`),
        ilike(stockMovements.reasonCode, `%${query}%`),
        ilike(stockMovements.batchNumber, `%${query}%`),
        ilike(stockMovements.lotNumber, `%${query}%`),
      )
    : undefined;

  const typeCondition =
    typeFilter && MOVEMENT_TYPES.includes(typeFilter as never)
      ? eq(stockMovements.movementType, typeFilter)
      : undefined;

  const movements = await db
    .select({
      movementId: stockMovements.movementId,
      movementType: stockMovements.movementType,
      quantity: stockMovements.quantity,
      batchNumber: stockMovements.batchNumber,
      lotNumber: stockMovements.lotNumber,
      reasonCode: stockMovements.reasonCode,
      createdAt: stockMovements.createdAt,
      sku: items.sku,
      itemName: items.name,
      sourceCode: sourceLocations.locationCode,
      destinationCode: destinationLocations.locationCode,
      employeeFirstName: employees.firstName,
      employeeLastName: employees.lastName,
    })
    .from(stockMovements)
    .leftJoin(
      sourceLocations,
      eq(stockMovements.sourceLocationId, sourceLocations.locationId),
    )
    .leftJoin(
      destinationLocations,
      eq(stockMovements.destinationLocationId, destinationLocations.locationId),
    )
    .leftJoin(items, eq(stockMovements.itemId, items.itemId))
    .leftJoin(employees, eq(stockMovements.employeeId, employees.employeeId))
    .where(and(warehouseCondition, searchCondition, typeCondition))
    .orderBy(desc(stockMovements.createdAt))
    .limit(ROW_LIMIT);

  const truncated = movements.length === ROW_LIMIT;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Stock Movements
        </h1>
        <p className="text-sm text-slate-500">
          Immutable audit trail of every quantity change in this warehouse.
        </p>
      </div>

      <form className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={query || ""}
            placeholder="Search SKU, item, location, or reason..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
          />
        </div>
        <select
          name="type"
          defaultValue={typeFilter ?? ""}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
        >
          <option value="">All types</option>
          {MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, " ")}
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

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">When</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Item</th>
              <th className="px-6 py-3">Movement</th>
              <th className="px-6 py-3">Reason</th>
              <th className="px-6 py-3">By</th>
              <th className="px-6 py-3 text-right">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {movements.map((movement) => (
              <tr key={movement.movementId} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-mono text-xs text-slate-500">
                  {movement.createdAt
                    ? movement.createdAt.replace("T", " ").slice(0, 19)
                    : "-"}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      typeStyles[movement.movementType] ??
                      "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {movement.movementType.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="font-mono text-xs font-bold text-slate-900">
                    {movement.sku ?? "-"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {movement.itemName ?? "Unknown item"}
                  </div>
                  {movement.batchNumber || movement.lotNumber ? (
                    <div className="font-mono text-[10px] text-slate-400">
                      {[movement.batchNumber, movement.lotNumber]
                        .filter(Boolean)
                        .join(" / ")}
                    </div>
                  ) : null}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-slate-600">
                      {movement.sourceCode ?? "—"}
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />
                    <span className="text-slate-600">
                      {movement.destinationCode ?? "—"}
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 text-xs text-slate-600">
                  {movement.reasonCode ?? "-"}
                </td>
                <td className="px-6 py-4 text-xs text-slate-600">
                  {[movement.employeeFirstName, movement.employeeLastName]
                    .filter(Boolean)
                    .join(" ") || "-"}
                </td>
                <td className="px-6 py-4 text-right font-mono text-sm font-semibold text-slate-900">
                  {movement.quantity}
                </td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                  No stock movements recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {truncated ? (
        <p className="text-xs text-slate-500">
          Showing the {ROW_LIMIT} most recent movements. Narrow the search to see
          more.
        </p>
      ) : null}
    </main>
  );
}
