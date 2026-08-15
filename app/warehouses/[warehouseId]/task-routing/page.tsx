import Link from "next/link";
import { requireInboundManagerAccess } from "@/lib/warehouse-access";
import { getTaskLookups, TASK_TYPE_CODES } from "@/lib/inbound/task-lookups";
import { listWarehouseDepartments } from "@/lib/tasks/routing";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft } from "lucide-react";
import { loadRoutingRules } from "./actions";
import { RoutingRuleRow } from "./rule-controls";

const TYPE_LABEL: Record<string, string> = {
  BOOKING: "Dock appointments",
  UNLOADING: "Unloading trailers",
  PUTAWAY: "Putaway",
  PICKING: "Picking",
  LOADING: "Loading trailers",
  REPLENISHMENT: "Replenishment",
  CYCLE_COUNT: "Cycle counts",
};

export default async function TaskRoutingRulesPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { warehouseId: parsedWarehouseId } =
    await requireInboundManagerAccess(warehouseId);

  // Makes sure the fixed task types exist before we render a row per type.
  await getTaskLookups();

  const [departmentOptions, rules] = await Promise.all([
    listWarehouseDepartments(parsedWarehouseId),
    loadRoutingRules(parsedWarehouseId),
  ]);

  return (
    <main className="flex-1 space-y-6 bg-slate-50 p-5 sm:p-8">
      <div>
        <DynamicBreadcrumb />
      </div>
      <Link
        href={`/warehouses/${parsedWarehouseId}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Task Routing Rules
        </h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Which team each kind of work goes to by default. New tasks pick this
          up automatically; whoever creates a task can still override it, and
          changing a rule never re-routes work already on the floor.
        </p>
      </div>

      {departmentOptions.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This warehouse has no departments yet, so there is nothing to route
          to.{" "}
          <Link
            href={`/warehouses/${parsedWarehouseId}/people-roles`}
            className="font-semibold underline"
          >
            Set up departments first
          </Link>
          .
        </div>
      ) : (
        <div className="space-y-2">
          {TASK_TYPE_CODES.map((code) => (
            <RoutingRuleRow
              key={code}
              warehouseId={parsedWarehouseId}
              typeCode={code}
              typeLabel={TYPE_LABEL[code] ?? code}
              options={departmentOptions}
              initial={rules[code] ?? []}
            />
          ))}
        </div>
      )}
    </main>
  );
}
