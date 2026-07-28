import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventoryStatuses } from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { Check, X } from "lucide-react";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import {
  AddStatusDialog,
  SeedStatusesButton,
  StatusRowActions,
} from "./status-controls";

function FlagCell({ value }: { value: boolean | null }) {
  return value !== false ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
      <Check className="h-3.5 w-3.5" /> Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
      <X className="h-3.5 w-3.5" /> No
    </span>
  );
}

export default async function InventoryStatusesPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireWarehouseAccess(warehouseId);

  const statusList = await db
    .select()
    .from(inventoryStatuses)
    .where(eq(inventoryStatuses.organizationId, employee.organizationId))
    .orderBy(asc(inventoryStatuses.name));

  const canModify = employee.canModifyInventory === true;

  return (
    <main className="flex-1 space-y-6 p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Inventory Statuses
          </h1>
          <p className="text-sm text-slate-500">
            Control whether stock in each status can be allocated, moved, or
            sold.
          </p>
        </div>
        {canModify ? <AddStatusDialog warehouseId={parsedWarehouseId} /> : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Allocatable</th>
              <th className="px-6 py-3">Movable</th>
              <th className="px-6 py-3">Sellable</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {statusList.map((status) => (
              <tr key={status.statusId} className="hover:bg-slate-50">
                <td className="px-6 py-4 font-medium text-slate-900">
                  {status.name}
                </td>
                <td className="px-6 py-4">
                  <FlagCell value={status.allowAllocation} />
                </td>
                <td className="px-6 py-4">
                  <FlagCell value={status.allowMovement} />
                </td>
                <td className="px-6 py-4">
                  <FlagCell value={status.isSellable} />
                </td>
                <td className="px-6 py-4 text-right">
                  {canModify ? (
                    <StatusRowActions
                      status={status}
                      warehouseId={parsedWarehouseId}
                    />
                  ) : (
                    <span className="text-xs text-slate-400">View only</span>
                  )}
                </td>
              </tr>
            ))}
            {statusList.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center">
                  <p className="text-slate-500">
                    No inventory statuses defined yet.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Stock cannot be recorded until at least one status exists.
                  </p>
                  {canModify ? (
                    <div className="mt-4">
                      <SeedStatusesButton warehouseId={parsedWarehouseId} />
                    </div>
                  ) : null}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
