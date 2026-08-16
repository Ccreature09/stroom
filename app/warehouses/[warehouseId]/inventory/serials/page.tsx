import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ArrowLeft, Barcode, Search, TriangleAlert } from "lucide-react";
import { db } from "@/lib/db";
import {
  customers,
  employees,
  inventorySerials,
  items,
  locations,
  purchaseOrderLines,
  purchaseOrders,
  salesOrders,
  shipments,
} from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { findSerialDrift } from "@/lib/inventory/serials-server";
import { serialKey } from "@/lib/inventory/serial-rules";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";

const statusStyles: Record<string, string> = {
  IN_STOCK: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PICKED: "bg-blue-50 text-blue-700 border-blue-200",
  SHIPPED: "bg-slate-100 text-slate-600 border-slate-200",
  CONSUMED: "bg-red-50 text-red-700 border-red-200",
};

/**
 * Serial lookup: the screen that answers "where is unit X, and who has it".
 *
 * Searching is deliberately exact-match-first on the serial and only falls
 * back to a prefix search: someone standing at a bench with a unit in their
 * hand types the whole number and wants the one row, not forty near-misses.
 */
export default async function SerialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ warehouseId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { warehouseId } = await params;
  const { q } = await searchParams;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireWarehouseAccess(warehouseId);

  const query = (q ?? "").trim();

  const receivedBy = employees;
  const rows = query
    ? await db
        .select({
          serialId: inventorySerials.serialId,
          serialNumber: inventorySerials.serialNumber,
          status: inventorySerials.status,
          sku: items.sku,
          itemName: items.name,
          batchNumber: inventorySerials.batchNumber,
          lotNumber: inventorySerials.lotNumber,
          expiryDate: inventorySerials.expiryDate,
          locationCode: locations.locationCode,
          lpnId: inventorySerials.lpnId,
          receivedAt: inventorySerials.receivedAt,
          pickedAt: inventorySerials.pickedAt,
          shippedAt: inventorySerials.shippedAt,
          poNumber: purchaseOrders.poNumber,
          soNumber: salesOrders.soNumber,
          customerName: customers.name,
          trackingNumber: salesOrders.trackingNumber,
          trailerNumber: shipments.trailerNumber,
          dispatchedAt: shipments.dispatchedAt,
          receivedByFirst: receivedBy.firstName,
          receivedByLast: receivedBy.lastName,
        })
        .from(inventorySerials)
        .innerJoin(items, eq(inventorySerials.itemId, items.itemId))
        .leftJoin(locations, eq(inventorySerials.locationId, locations.locationId))
        .leftJoin(
          purchaseOrderLines,
          eq(inventorySerials.poLineId, purchaseOrderLines.poLineId),
        )
        .leftJoin(purchaseOrders, eq(purchaseOrderLines.poId, purchaseOrders.poId))
        .leftJoin(salesOrders, eq(inventorySerials.soId, salesOrders.soId))
        .leftJoin(customers, eq(salesOrders.customerId, customers.customerId))
        .leftJoin(shipments, eq(inventorySerials.shipmentId, shipments.shipmentId))
        .leftJoin(
          receivedBy,
          eq(inventorySerials.receivedByEmployeeId, receivedBy.employeeId),
        )
        .where(
          and(
            eq(inventorySerials.organizationId, employee.organizationId),
            or(
              eq(sql`upper(${inventorySerials.serialNumber})`, serialKey(query)),
              ilike(inventorySerials.serialNumber, `${query}%`),
              ilike(items.sku, query),
            ),
          ),
        )
        .orderBy(desc(inventorySerials.receivedAt))
        .limit(50)
    : [];

  const drift = await findSerialDrift(parsedWarehouseId);

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      inStock: sql<number>`count(*) filter (where ${inventorySerials.status} = 'IN_STOCK')::int`,
      picked: sql<number>`count(*) filter (where ${inventorySerials.status} = 'PICKED')::int`,
      shipped: sql<number>`count(*) filter (where ${inventorySerials.status} = 'SHIPPED')::int`,
    })
    .from(inventorySerials)
    .where(eq(inventorySerials.organizationId, employee.organizationId));

  const [tracked] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(
      and(
        eq(items.organizationId, employee.organizationId),
        eq(items.isSerialTracked, true),
      ),
    );

  return (
    <main className="flex-1 space-y-6 bg-slate-50 p-5 sm:p-8">
      <div>
        <DynamicBreadcrumb />
      </div>
      <Link
        href={`/warehouses/${parsedWarehouseId}/inventory`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Inventory
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Serial Lookup
        </h1>
        <p className="text-sm text-slate-500">
          Trace one physical unit from the delivery that brought it in to the
          customer it went out to.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-4">
        <Stat label="Units tracked" value={Number(totals?.total ?? 0)} />
        <Stat label="In stock" value={Number(totals?.inStock ?? 0)} />
        <Stat label="Picked" value={Number(totals?.picked ?? 0)} />
        <Stat label="Shipped" value={Number(totals?.shipped ?? 0)} />
      </section>

      {Number(tracked?.n ?? 0) === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No item is marked serial tracked yet. Turn it on for an item in{" "}
          <Link
            href={`/warehouses/${parsedWarehouseId}/master-data/items`}
            className="font-semibold underline"
          >
            the item catalog
          </Link>{" "}
          and units received from then on will be scanned individually.
        </div>
      ) : null}

      <form className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          name="q"
          defaultValue={query}
          placeholder="Scan or type a serial number, or a SKU..."
          className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10"
        />
      </form>

      {query ? (
        rows.length > 0 ? (
          <div className="space-y-3">
            {rows.map((row) => (
              <article
                key={row.serialId}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
                  <div>
                    <div className="font-mono text-lg font-bold text-slate-900">
                      {row.serialNumber}
                    </div>
                    <div className="text-xs text-slate-500">
                      <span className="font-mono font-semibold">{row.sku}</span>{" "}
                      · {row.itemName}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      statusStyles[row.status] ??
                      "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {row.status.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-3">
                  <Trace
                    heading="Came in"
                    when={row.receivedAt}
                    lines={[
                      row.poNumber ? `PO ${row.poNumber}` : "Ad-hoc receipt",
                      [row.receivedByFirst, row.receivedByLast]
                        .filter(Boolean)
                        .join(" ") || null,
                      row.batchNumber ? `Batch ${row.batchNumber}` : null,
                      row.lotNumber ? `Lot ${row.lotNumber}` : null,
                      row.expiryDate ? `Expires ${row.expiryDate}` : null,
                    ]}
                  />
                  <Trace
                    heading={row.status === "IN_STOCK" ? "Sitting at" : "Picked"}
                    when={row.pickedAt}
                    lines={[
                      row.locationCode,
                      row.lpnId ? `Pallet ${row.lpnId}` : null,
                      row.soNumber ? `Order ${row.soNumber}` : null,
                    ]}
                  />
                  <Trace
                    heading="Went out"
                    when={row.shippedAt ?? row.dispatchedAt}
                    lines={[
                      row.customerName,
                      row.trailerNumber ? `Trailer ${row.trailerNumber}` : null,
                      row.trackingNumber ? `Tracking ${row.trackingNumber}` : null,
                    ]}
                  />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
            Nothing matches &ldquo;{query}&rdquo;. A unit received before its
            item was marked serial tracked will not be here.
          </p>
        )
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">
          <Barcode className="mx-auto mb-2 h-6 w-6 text-slate-300" />
          Scan a serial number to trace it.
        </p>
      )}

      {/* Reconciliation. Two tables describe the same physical reality and the
          application keeps them in step -- but an adjustment made against
          stock alone, or a direct database edit, would separate them. Better
          to show that than to claim it cannot happen. */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <TriangleAlert
            className={`h-4 w-4 ${drift.length > 0 ? "text-amber-500" : "text-slate-300"}`}
          />
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
              Reconciliation
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Where the stock quantity and the number of serials in a bin
              disagree.
            </p>
          </div>
        </div>
        {drift.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-emerald-700">
            Every serial-tracked bin reconciles.
          </p>
        ) : (
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-700">
              <tr>
                <th className="px-5 py-3">Location</th>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3 text-right">Stock says</th>
                <th className="px-5 py-3 text-right">Serials say</th>
                <th className="px-5 py-3 text-right">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {drift.map((d) => (
                <tr
                  key={`${d.locationId}-${d.itemId}-${d.batchNumber}-${d.lotNumber}`}
                  className="hover:bg-slate-50"
                >
                  <td className="px-5 py-3 font-mono text-xs font-semibold text-slate-900">
                    {d.locationCode}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">
                    {d.sku}
                    {d.batchNumber ? (
                      <span className="ml-2 text-slate-400">
                        batch {d.batchNumber}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs">
                    {d.stockQuantity}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs">
                    {d.serialCount}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-xs font-bold text-amber-700">
                    {d.serialCount - d.stockQuantity > 0 ? "+" : ""}
                    {d.serialCount - d.stockQuantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 text-2xl font-bold text-slate-900">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Trace({
  heading,
  when,
  lines,
}: {
  heading: string;
  when: string | null;
  lines: (string | null)[];
}) {
  const shown = lines.filter(Boolean) as string[];
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        {heading}
      </div>
      {when ? (
        <div className="mt-0.5 font-mono text-xs text-slate-900">
          {when.replace("T", " ").slice(0, 16)}
        </div>
      ) : (
        <div className="mt-0.5 text-xs text-slate-300">--</div>
      )}
      {shown.map((line) => (
        <div key={line} className="mt-0.5 text-xs text-slate-600">
          {line}
        </div>
      ))}
    </div>
  );
}
