import { and, eq, ilike, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { items, employees } from "@/drizzle/schema";
import { createClient } from "@/lib/server";
import { Search, ShieldAlert, Package, Layers } from "lucide-react";
import { AddItemDialog } from "./add-item-dialog";
import { ItemRowActions } from "./item-row-actions";

type SearchParams = Promise<{ q?: string }>;

export default async function WarehouseItemCatalogMasterDataPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: SearchParams;
}) {
  const { warehouseId } = await params;
  const { q: query } = await searchParams;
  const parsedWarehouseId = Number(warehouseId);

  if (!Number.isInteger(parsedWarehouseId) || parsedWarehouseId <= 0) {
    redirect("/warehouses");
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/sign-in");

  const [currentEmployee] = await db
    .select({ organizationId: employees.organizationId })
    .from(employees)
    .where(and(eq(employees.authUserId, userId), eq(employees.isActive, true)))
    .limit(1);

  if (!currentEmployee) redirect("/sign-in");

  const baseCondition = eq(
    items.organizationId,
    currentEmployee.organizationId,
  );
  const searchCondition = query
    ? or(
        ilike(items.name, `%${query}%`),
        ilike(items.sku, `%${query}%`),
        ilike(items.barcode, `%${query}%`),
      )
    : undefined;

  const itemList = await db
    .select()
    .from(items)
    .where(
      searchCondition ? and(baseCondition, searchCondition) : baseCondition,
    );

  return (
    <main className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Item Catalog
          </h1>
          <p className="text-sm text-slate-500">
            Master SKU catalog, product dimensions, and tracking specifications.
          </p>
        </div>
        <AddItemDialog warehouseId={parsedWarehouseId} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <form className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={query || ""}
            placeholder="Search by SKU, name, or barcode..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
          />
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
            <tr>
              <th className="px-6 py-3">SKU / Barcode</th>
              <th className="px-6 py-3">Item Name & Category</th>
              <th className="px-6 py-3">Dimensions (L×W×H)</th>
              <th className="px-6 py-3">Weight</th>
              <th className="px-6 py-3">Tracking</th>
              <th className="px-6 py-3">Min Stock</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {itemList.map((item) => (
              <tr key={item.itemId} className="hover:bg-slate-50">
                <td className="px-6 py-4">
                  <div className="font-mono text-xs font-bold text-slate-900">
                    {item.sku}
                  </div>
                  <div className="font-mono text-[11px] text-slate-400">
                    {item.barcode ?? "-"}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="font-medium text-slate-900">{item.name}</div>
                  <div className="text-xs text-slate-500">
                    {item.category ?? "Uncategorized"}
                  </div>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {item.lengthCm}×{item.widthCm}×{item.heightCm} cm
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-600">
                  {item.weightKg} kg
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {item.isBatchTracked && (
                      <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 border border-blue-200">
                        <Layers className="h-2.5 w-2.5" /> Batch
                      </span>
                    )}
                    {item.isLotTracked && (
                      <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 border border-purple-200">
                        <Package className="h-2.5 w-2.5" /> Lot
                      </span>
                    )}
                    {item.hasExpiry && (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                        <ShieldAlert className="h-2.5 w-2.5" /> Expiry
                      </span>
                    )}
                    {!item.isBatchTracked &&
                      !item.isLotTracked &&
                      !item.hasExpiry && (
                        <span className="text-xs text-slate-400">Standard</span>
                      )}
                  </div>
                </td>
                <td className="px-6 py-4 font-mono text-xs text-slate-700">
                  {item.minStockLevel ?? 0}
                </td>
                <td className="px-6 py-4 text-right">
                  <ItemRowActions item={item} warehouseId={parsedWarehouseId} />
                </td>
              </tr>
            ))}
            {itemList.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-6 py-8 text-center text-slate-500"
                >
                  No items found in catalog.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
