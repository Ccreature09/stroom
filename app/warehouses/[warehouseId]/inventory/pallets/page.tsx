import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { locations, pallets } from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { Search } from "lucide-react";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { AddPalletDialog, PalletRowActions } from "./pallet-controls";
import { PALLET_STATUSES } from "./constants";

const ROW_LIMIT = 500;

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 border-emerald-200",
  IN_TRANSIT: "bg-blue-50 text-blue-700 border-blue-200",
  CONSUMED: "bg-slate-100 text-slate-600 border-slate-200",
  DAMAGED: "bg-red-50 text-red-700 border-red-200",
};

type SearchParams = Promise<{ q?: string; status?: string }>;

export default async function PalletsPage({
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

  const searchCondition = query
    ? or(
        ilike(pallets.lpnId, `%${query}%`),
        ilike(locations.locationCode, `%${query}%`),
      )
    : undefined;

  const statusCondition =
    statusFilter && PALLET_STATUSES.includes(statusFilter as never)
      ? eq(pallets.status, statusFilter)
      : undefined;

  const [palletList, locationOptions] = await Promise.all([
    db
      .select({
        lpnId: pallets.lpnId,
        status: pallets.status,
        currentLocationId: pallets.currentLocationId,
        currentLocationCode: locations.locationCode,
        createdAt: pallets.createdAt,
      })
      .from(pallets)
      // Left join: a pallet with no current location is still this
      // warehouse's pallet and must not drop out of the list.
      .leftJoin(locations, eq(pallets.currentLocationId, locations.locationId))
      .where(
        and(
          eq(pallets.warehouseId, parsedWarehouseId),
          searchCondition,
          statusCondition,
        ),
      )
      .orderBy(desc(pallets.createdAt))
      .limit(ROW_LIMIT),
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
  ]);

  const canModify = employee.canModifyInventory === true;
  const truncated = palletList.length === ROW_LIMIT;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Pallets (LPNs)
          </h1>
          <p className="text-sm text-slate-500">
            License plate numbers tracking physical pallets through the
            warehouse.
          </p>
        </div>
        {canModify ? (
          <AddPalletDialog
            warehouseId={parsedWarehouseId}
            locationOptions={locationOptions}
          />
        ) : null}
      </div>

      <form className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={query || ""}
            placeholder="Search LPN or location..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
          />
        </div>
        <select
          name="status"
          defaultValue={statusFilter ?? ""}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
        >
          <option value="">All statuses</option>
          {PALLET_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, " ")}
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
              <th className="px-6 py-3">LPN</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Current Location</th>
              <th className="px-6 py-3">Created</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {palletList.map((pallet) => (
              <tr key={pallet.lpnId} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-mono text-xs font-bold text-slate-900">
                  {pallet.lpnId}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                      statusStyles[pallet.status ?? ""] ??
                      "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {(pallet.status ?? "UNKNOWN").replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {pallet.currentLocationCode ?? (
                    <span className="text-slate-400">Unassigned</span>
                  )}
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-500">
                  {pallet.createdAt
                    ? pallet.createdAt.replace("T", " ").slice(0, 19)
                    : "-"}
                </td>
                <td className="px-6 py-4 text-right">
                  {canModify ? (
                    <PalletRowActions
                      pallet={pallet}
                      warehouseId={parsedWarehouseId}
                      locationOptions={locationOptions}
                    />
                  ) : (
                    <span className="text-xs text-slate-400">View only</span>
                  )}
                </td>
              </tr>
            ))}
            {palletList.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                  No pallets registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {truncated ? (
        <p className="text-xs text-slate-500">
          Showing the first {ROW_LIMIT} pallets. Narrow the search to see more.
        </p>
      ) : null}
    </main>
  );
}
