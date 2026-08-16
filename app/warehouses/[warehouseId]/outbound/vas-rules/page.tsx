import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, items, vasRuleSteps, vasRules } from "@/drizzle/schema";
import { requireOutboundManagerAccess } from "@/lib/warehouse-access";
import { getTaskLookups } from "@/lib/inbound/task-lookups";
import { loadTaskSetting } from "@/lib/vas/vas-server";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ArrowLeft, Sparkles } from "lucide-react";
import { CreateVasRuleDialog, VasEnableToggle, VasRuleActions } from "./rule-controls";

export default async function VasRulesPage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireOutboundManagerAccess(warehouseId);

  await getTaskLookups();

  const [setting, ruleRows, customerOptions, itemOptions] = await Promise.all([
    loadTaskSetting(db, parsedWarehouseId, "VAS"),
    db
      .select({
        ruleId: vasRules.ruleId,
        name: vasRules.name,
        description: vasRules.description,
        appliesTo: vasRules.appliesTo,
        isActive: vasRules.isActive,
        customerName: customers.name,
        itemSku: items.sku,
      })
      .from(vasRules)
      .leftJoin(customers, eq(vasRules.customerId, customers.customerId))
      .leftJoin(items, eq(vasRules.itemId, items.itemId))
      .where(eq(vasRules.warehouseId, parsedWarehouseId))
      .orderBy(asc(vasRules.ruleId)),
    db
      .select({ customerId: customers.customerId, name: customers.name })
      .from(customers)
      .where(
        and(
          eq(customers.organizationId, employee.organizationId),
          eq(customers.isActive, true),
        ),
      )
      .orderBy(asc(customers.name)),
    db
      .select({ itemId: items.itemId, sku: items.sku, name: items.name })
      .from(items)
      .where(eq(items.organizationId, employee.organizationId))
      .orderBy(asc(items.sku)),
  ]);

  const stepRows = ruleRows.length
    ? await db
        .select({
          ruleId: vasRuleSteps.ruleId,
          instruction: vasRuleSteps.instruction,
          sortOrder: vasRuleSteps.sortOrder,
        })
        .from(vasRuleSteps)
        .where(inArray(vasRuleSteps.ruleId, ruleRows.map((r) => r.ruleId)))
        .orderBy(asc(vasRuleSteps.sortOrder))
    : [];

  const stepsByRule = new Map<number, string[]>();
  for (const s of stepRows) {
    stepsByRule.set(s.ruleId, [...(stepsByRule.get(s.ruleId) ?? []), s.instruction]);
  }

  const canEdit = employee.canAssignTasks === true;

  return (
    <main className="flex-1 space-y-6 bg-slate-50 p-5 sm:p-8">
      <div>
        <DynamicBreadcrumb />
      </div>
      <Link
        href={`/warehouses/${parsedWarehouseId}/outbound`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Outbound
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Value-Added Services
          </h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Packing, labelling, kitting -- anything done to an order after it
            is picked and before it ships. A warehouse that only sends full
            pallets can leave this switched off entirely.
          </p>
        </div>
        {canEdit ? (
          <CreateVasRuleDialog
            warehouseId={parsedWarehouseId}
            customerOptions={customerOptions}
            itemOptions={itemOptions}
            disabled={!setting.isEnabled}
          />
        ) : null}
      </div>

      <VasEnableToggle
        warehouseId={parsedWarehouseId}
        isEnabled={setting.isEnabled}
        autoCreate={setting.autoCreate}
        canEdit={canEdit}
      />

      {setting.isEnabled ? (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
            Standing rules ({ruleRows.length})
          </h2>

          {ruleRows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
              <Sparkles className="h-6 w-6 text-slate-300" />
              <p className="text-sm text-slate-500">
                No rules yet. Without one, orders finish picking and go
                straight to shipping.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {ruleRows.map((rule) => (
                <div
                  key={rule.ruleId}
                  className={`rounded-xl border bg-white p-4 shadow-sm ${
                    rule.isActive ? "border-slate-200" : "border-slate-200 opacity-60"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">
                          {rule.name}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                          {rule.appliesTo === "ALL"
                            ? "Every order"
                            : rule.appliesTo === "CUSTOMER"
                              ? `Customer: ${rule.customerName ?? "?"}`
                              : `Item: ${rule.itemSku ?? "?"}`}
                        </span>
                        {!rule.isActive ? (
                          <span className="text-[10px] font-semibold text-slate-400">
                            INACTIVE
                          </span>
                        ) : null}
                      </div>
                      {rule.description ? (
                        <p className="mt-1 text-xs text-slate-500">{rule.description}</p>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <VasRuleActions
                        warehouseId={parsedWarehouseId}
                        ruleId={rule.ruleId}
                        isActive={rule.isActive}
                      />
                    ) : null}
                  </div>

                  <ol className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                    {(stepsByRule.get(rule.ruleId) ?? []).map((instruction, i) => (
                      <li key={i} className="flex gap-2 text-xs text-slate-700">
                        <span className="font-mono text-slate-400">{i + 1}.</span>
                        <span>{instruction}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}
