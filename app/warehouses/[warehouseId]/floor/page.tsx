import Link from "next/link";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bookingTasks,
  cycleCountTasks,
  items,
  loadingTasks,
  locations,
  pickingTasks,
  putawayTasks,
  replenishmentTasks,
  taskStatuses,
  tasks,
  taskTypes,
  timeClockEntries,
  unloadingTasks,
} from "@/drizzle/schema";
import { requireWarehouseAccess } from "@/lib/warehouse-access";
import { getTaskLookups } from "@/lib/inbound/task-lookups";
import {
  loadEmployeeDepartmentIds,
  listWarehouseDepartments,
  taskRoutingFilter,
} from "@/lib/tasks/routing";
import { DynamicBreadcrumb } from "@/components/layout/dynamic-breadcrumb";
import { ClockWidget } from "../timeclock/clock-widget";
import {
  ArrowDownUp,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  PackageCheck,
  PackagePlus,
  Truck,
  TruckIcon,
} from "lucide-react";

const ACTIVE_STATUSES = ["PENDING", "IN_PROGRESS"] as const;

const statusStyles: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-200",
};

/**
 * The worker-facing surface: what's assigned to me (or unclaimed and open
 * to anyone with the right permission), never the supplier/cost picture the
 * `/inbound` management pages carry. See requireInboundManagerAccess for
 * the other half of that split.
 */
export default async function FloorHomePage({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  const { employee, warehouseId: parsedWarehouseId } =
    await requireWarehouseAccess(warehouseId);

  await getTaskLookups();

  const [myDepartmentIds, warehouseDepartments, openShiftRows] = await Promise.all([
    loadEmployeeDepartmentIds(employee.employeeId),
    listWarehouseDepartments(parsedWarehouseId),
    db
      .select({
        clockInAt: timeClockEntries.clockInAt,
        breakMinutes: timeClockEntries.breakMinutes,
      })
      .from(timeClockEntries)
      .where(
        and(
          eq(timeClockEntries.employeeId, employee.employeeId),
          eq(timeClockEntries.warehouseId, parsedWarehouseId),
          isNull(timeClockEntries.clockOutAt),
        ),
      )
      .orderBy(desc(timeClockEntries.clockInAt))
      .limit(1),
  ]);
  const openShift = openShiftRows[0] ?? null;
  const myDepartments = warehouseDepartments.filter((d) =>
    myDepartmentIds.includes(d.departmentId),
  );

  /**
   * What reaches this worker's list: work that is theirs or free to take,
   * narrowed to what their department is actually meant to handle.
   *
   * The two predicates compose rather than duplicate -- `mine` decides
   * whether the task is claimable at all, `taskRoutingFilter` decides
   * whether it belongs to this worker's part of the building. An explicit
   * assignment satisfies both, which is what stops a cross-department
   * assignment from vanishing.
   */
  const mine = and(
    or(
      eq(tasks.assignedEmployeeId, employee.employeeId),
      isNull(tasks.assignedEmployeeId),
    ),
    taskRoutingFilter(employee.employeeId, myDepartmentIds),
  );

  const [
    bookingRows,
    unloadingRows,
    putawayRows,
    pickingRows,
    loadingRows,
    replenRows,
    countRows,
  ] = await Promise.all([
    employee.canBook
      ? db
          .select({
            taskId: tasks.taskId,
            statusCode: taskStatuses.code,
            assignedEmployeeId: tasks.assignedEmployeeId,
            dockDoorCode: locations.locationCode,
            sku: items.sku,
            productQuantity: bookingTasks.productQuantity,
          })
          .from(bookingTasks)
          .innerJoin(tasks, eq(bookingTasks.taskId, tasks.taskId))
          .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
          .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
          .leftJoin(locations, eq(bookingTasks.dockDoorLocationId, locations.locationId))
          .leftJoin(items, eq(bookingTasks.itemId, items.itemId))
          .where(
            and(
              eq(tasks.warehouseId, parsedWarehouseId),
              eq(taskTypes.code, "BOOKING"),
              mine,
              or(...ACTIVE_STATUSES.map((code) => eq(taskStatuses.code, code))),
            ),
          )
          .orderBy(desc(tasks.priority), tasks.createdAt)
          .limit(20)
      : Promise.resolve([]),
    employee.canUnload
      ? db
          .select({
            taskId: tasks.taskId,
            statusCode: taskStatuses.code,
            assignedEmployeeId: tasks.assignedEmployeeId,
            dockDoorCode: locations.locationCode,
            trailerNumber: unloadingTasks.trailerNumber,
            expectedPallets: unloadingTasks.expectedPallets,
          })
          .from(unloadingTasks)
          .innerJoin(tasks, eq(unloadingTasks.taskId, tasks.taskId))
          .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
          .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
          .leftJoin(locations, eq(unloadingTasks.dockDoorLocationId, locations.locationId))
          .where(
            and(
              eq(tasks.warehouseId, parsedWarehouseId),
              eq(taskTypes.code, "UNLOADING"),
              mine,
              or(...ACTIVE_STATUSES.map((code) => eq(taskStatuses.code, code))),
            ),
          )
          .orderBy(desc(tasks.priority), tasks.createdAt)
          .limit(20)
      : Promise.resolve([]),
    employee.canModifyInventory
      ? db
          .select({
            taskId: tasks.taskId,
            statusCode: taskStatuses.code,
            assignedEmployeeId: tasks.assignedEmployeeId,
            lpnId: putawayTasks.lpnId,
            suggestedDestCode: locations.locationCode,
          })
          .from(putawayTasks)
          .innerJoin(tasks, eq(putawayTasks.taskId, tasks.taskId))
          .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
          .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
          .leftJoin(locations, eq(putawayTasks.suggestedDestLocationId, locations.locationId))
          .where(
            and(
              eq(tasks.warehouseId, parsedWarehouseId),
              eq(taskTypes.code, "PUTAWAY"),
              mine,
              or(...ACTIVE_STATUSES.map((code) => eq(taskStatuses.code, code))),
            ),
          )
          .orderBy(desc(tasks.priority), tasks.createdAt)
          .limit(20)
      : Promise.resolve([]),
    employee.canPick
      ? db
          .select({
            taskId: tasks.taskId,
            statusCode: taskStatuses.code,
            assignedEmployeeId: tasks.assignedEmployeeId,
            lpnId: pickingTasks.lpnId,
            pickQuantity: pickingTasks.pickQuantity,
            sku: items.sku,
            locationCode: locations.locationCode,
          })
          .from(pickingTasks)
          .innerJoin(tasks, eq(pickingTasks.taskId, tasks.taskId))
          .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
          .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
          .leftJoin(items, eq(pickingTasks.itemId, items.itemId))
          .leftJoin(locations, eq(pickingTasks.pickLocationId, locations.locationId))
          .where(
            and(
              eq(tasks.warehouseId, parsedWarehouseId),
              eq(taskTypes.code, "PICKING"),
              mine,
              or(...ACTIVE_STATUSES.map((code) => eq(taskStatuses.code, code))),
            ),
          )
          // Same pallet, then same aisle -- one walk, not a zigzag.
          .orderBy(pickingTasks.lpnId, locations.locationCode)
          .limit(20)
      : Promise.resolve([]),
    employee.canLoad
      ? db
          .select({
            taskId: tasks.taskId,
            statusCode: taskStatuses.code,
            assignedEmployeeId: tasks.assignedEmployeeId,
            lpnId: loadingTasks.lpnId,
            sequenceNumber: loadingTasks.sequenceNumber,
            dockDoorCode: locations.locationCode,
          })
          .from(loadingTasks)
          .innerJoin(tasks, eq(loadingTasks.taskId, tasks.taskId))
          .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
          .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
          .leftJoin(locations, eq(loadingTasks.dockDoorLocationId, locations.locationId))
          .where(
            and(
              eq(tasks.warehouseId, parsedWarehouseId),
              eq(taskTypes.code, "LOADING"),
              mine,
              or(...ACTIVE_STATUSES.map((code) => eq(taskStatuses.code, code))),
            ),
          )
          .orderBy(loadingTasks.sequenceNumber)
          .limit(20)
      : Promise.resolve([]),
    employee.canReplenish
      ? db
          .select({
            taskId: tasks.taskId,
            statusCode: taskStatuses.code,
            assignedEmployeeId: tasks.assignedEmployeeId,
            quantity: replenishmentTasks.quantity,
            sourceLocationId: replenishmentTasks.sourceLocationId,
            destinationLocationId: replenishmentTasks.destinationLocationId,
            sku: items.sku,
          })
          .from(replenishmentTasks)
          .innerJoin(tasks, eq(replenishmentTasks.taskId, tasks.taskId))
          .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
          .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
          .leftJoin(items, eq(replenishmentTasks.itemId, items.itemId))
          .where(
            and(
              eq(tasks.warehouseId, parsedWarehouseId),
              eq(taskTypes.code, "REPLENISHMENT"),
              mine,
              or(...ACTIVE_STATUSES.map((code) => eq(taskStatuses.code, code))),
            ),
          )
          .orderBy(tasks.priority, tasks.createdAt)
          .limit(20)
      : Promise.resolve([]),
    employee.canModifyInventory
      ? db
          .select({
            taskId: tasks.taskId,
            statusCode: taskStatuses.code,
            assignedEmployeeId: tasks.assignedEmployeeId,
            sku: items.sku,
            locationCode: locations.locationCode,
            // expectedQuantity deliberately not selected -- counts are blind.
          })
          .from(cycleCountTasks)
          .innerJoin(tasks, eq(cycleCountTasks.taskId, tasks.taskId))
          .innerJoin(taskStatuses, eq(tasks.statusId, taskStatuses.statusId))
          .innerJoin(taskTypes, eq(tasks.taskTypeId, taskTypes.taskTypeId))
          .leftJoin(items, eq(cycleCountTasks.itemId, items.itemId))
          .leftJoin(locations, eq(cycleCountTasks.locationId, locations.locationId))
          .where(
            and(
              eq(tasks.warehouseId, parsedWarehouseId),
              eq(taskTypes.code, "CYCLE_COUNT"),
              mine,
              or(...ACTIVE_STATUSES.map((code) => eq(taskStatuses.code, code))),
            ),
          )
          .orderBy(locations.locationCode)
          .limit(20)
      : Promise.resolve([]),
  ]);

  // Location codes for the replenishment rows -- two locations per task, so
  // joining `locations` twice would need two aliases.
  const replenLocationIds = [
    ...new Set(replenRows.flatMap((r) => [r.sourceLocationId, r.destinationLocationId])),
  ];
  const replenLocations = replenLocationIds.length
    ? await db
        .select({ locationId: locations.locationId, locationCode: locations.locationCode })
        .from(locations)
        .where(
          and(
            eq(locations.warehouseId, parsedWarehouseId),
            inArray(locations.locationId, replenLocationIds),
          ),
        )
    : [];
  const replenCodeById = new Map(
    replenLocations.map((l) => [l.locationId, l.locationCode]),
  );

  const hasAnySection =
    employee.canBook ||
    employee.canUnload ||
    employee.canModifyInventory ||
    employee.canPick ||
    employee.canLoad ||
    employee.canReplenish;

  return (
    <main className="flex-1 space-y-6 bg-slate-50 p-5 sm:p-8">
      <div>
        <DynamicBreadcrumb />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            My Tasks
          </h1>
          <p className="text-sm text-slate-500">
            {[employee.firstName, employee.lastName].filter(Boolean).join(" ") ||
              "Welcome"}{" "}
            -- what needs doing right now.
          </p>
        </div>
        {/* Which departments this list is filtered to. Shown because an
            empty list otherwise looks like a bug rather than a routing
            decision someone made. */}
        <div className="text-right">
          {myDepartments.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1">
              {myDepartments.map((d) => (
                <span
                  key={d.departmentId}
                  className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600"
                >
                  {d.departmentName}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-slate-400">
              No department -- showing unrouted work only
            </span>
          )}
        </div>
      </div>

      <ClockWidget warehouseId={parsedWarehouseId} openShift={openShift} />

      {employee.canModifyInventory ? (
        <Link
          href={`/warehouses/${parsedWarehouseId}/floor/receive`}
          className="flex items-center gap-3 rounded-2xl border-2 border-teal-600 bg-teal-50 px-5 py-4 text-teal-900 shadow-sm transition hover:bg-teal-100"
        >
          <PackagePlus className="h-6 w-6 shrink-0" />
          <div>
            <div className="text-base font-bold">Book Items</div>
            <div className="text-sm text-teal-800">
              Receive stock -- bulk or scanned in one at a time
            </div>
          </div>
        </Link>
      ) : null}

      {!hasAnySection ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Nothing is set up for your role yet. Ask your supervisor to grant
          booking, unloading, or inventory permissions.
        </div>
      ) : null}

      {employee.canBook ? (
        <TaskSection
          title="Dock Appointments"
          icon={<CalendarClock className="h-5 w-5 text-slate-400" />}
          emptyLabel="No dock appointments waiting."
        >
          {bookingRows.map((row) => (
            <Link
              key={row.taskId}
              href={`/warehouses/${parsedWarehouseId}/floor/booking/${row.taskId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-slate-900">
                  {row.dockDoorCode ?? "Dock TBD"}
                </div>
                <div className="text-xs text-slate-500">
                  {row.sku ?? "Item"} · {row.productQuantity} units
                  {row.assignedEmployeeId ? "" : " · unclaimed"}
                </div>
              </div>
              <StatusPill code={row.statusCode} />
            </Link>
          ))}
        </TaskSection>
      ) : null}

      {employee.canUnload ? (
        <TaskSection
          title="Trucks to Unload"
          icon={<Truck className="h-5 w-5 text-slate-400" />}
          emptyLabel="No trucks waiting to be unloaded."
        >
          {unloadingRows.map((row) => (
            <Link
              key={row.taskId}
              href={`/warehouses/${parsedWarehouseId}/floor/unloading/${row.taskId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-slate-900">
                  {row.dockDoorCode ?? "Dock TBD"}
                  {row.trailerNumber ? ` · ${row.trailerNumber}` : ""}
                </div>
                <div className="text-xs text-slate-500">
                  ~{row.expectedPallets} pallets expected
                  {row.assignedEmployeeId ? "" : " · unclaimed"}
                </div>
              </div>
              <StatusPill code={row.statusCode} />
            </Link>
          ))}
        </TaskSection>
      ) : null}

      {employee.canPick ? (
        <TaskSection
          title="Picks"
          icon={<ClipboardCheck className="h-5 w-5 text-slate-400" />}
          emptyLabel="No picks waiting."
        >
          {pickingRows.map((row) => (
            <Link
              key={row.taskId}
              href={`/warehouses/${parsedWarehouseId}/floor/picking/${row.taskId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-slate-900">
                  {row.locationCode ?? "?"} · {row.sku ?? "?"}
                </div>
                <div className="text-xs text-slate-500">
                  Take {row.pickQuantity} → {row.lpnId}
                  {row.assignedEmployeeId ? "" : " · unclaimed"}
                </div>
              </div>
              <StatusPill code={row.statusCode} />
            </Link>
          ))}
        </TaskSection>
      ) : null}

      {employee.canLoad ? (
        <TaskSection
          title="Loading"
          icon={<TruckIcon className="h-5 w-5 text-slate-400" />}
          emptyLabel="No pallets waiting to be loaded."
        >
          {loadingRows.map((row) => (
            <Link
              key={row.taskId}
              href={`/warehouses/${parsedWarehouseId}/floor/loading/${row.taskId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-slate-900">
                  {row.lpnId}
                </div>
                <div className="text-xs text-slate-500">
                  #{row.sequenceNumber} at {row.dockDoorCode ?? "?"}
                  {row.assignedEmployeeId ? "" : " · unclaimed"}
                </div>
              </div>
              <StatusPill code={row.statusCode} />
            </Link>
          ))}
        </TaskSection>
      ) : null}

      {employee.canReplenish ? (
        <TaskSection
          title="Replenishment"
          icon={<ArrowDownUp className="h-5 w-5 text-slate-400" />}
          emptyLabel="No pick faces need topping up."
        >
          {replenRows.map((row) => (
            <Link
              key={row.taskId}
              href={`/warehouses/${parsedWarehouseId}/floor/replenishment/${row.taskId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-slate-900">
                  {replenCodeById.get(row.sourceLocationId) ?? "?"} →{" "}
                  {replenCodeById.get(row.destinationLocationId) ?? "?"}
                </div>
                <div className="text-xs text-slate-500">
                  {row.sku ?? "?"} · move {row.quantity}
                  {row.assignedEmployeeId ? "" : " · unclaimed"}
                </div>
              </div>
              <StatusPill code={row.statusCode} />
            </Link>
          ))}
        </TaskSection>
      ) : null}

      {employee.canModifyInventory ? (
        <TaskSection
          title="Stock Counts"
          icon={<ClipboardList className="h-5 w-5 text-slate-400" />}
          emptyLabel="No counts waiting."
        >
          {countRows.map((row) => (
            <Link
              key={row.taskId}
              href={`/warehouses/${parsedWarehouseId}/floor/cycle-count/${row.taskId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-slate-900">
                  {row.locationCode ?? "?"}
                </div>
                <div className="text-xs text-slate-500">
                  Count {row.sku ?? "?"}
                  {row.assignedEmployeeId ? "" : " · unclaimed"}
                </div>
              </div>
              <StatusPill code={row.statusCode} />
            </Link>
          ))}
        </TaskSection>
      ) : null}

      {employee.canModifyInventory ? (
        <TaskSection
          title="Putaway"
          icon={<PackageCheck className="h-5 w-5 text-slate-400" />}
          emptyLabel="No putaway tasks waiting."
        >
          {putawayRows.map((row) => (
            <Link
              key={row.taskId}
              href={`/warehouses/${parsedWarehouseId}/floor/putaway/${row.taskId}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm transition hover:border-teal-300 hover:shadow-md"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-slate-900">
                  {row.lpnId}
                </div>
                <div className="text-xs text-slate-500">
                  To {row.suggestedDestCode ?? "?"}
                  {row.assignedEmployeeId ? "" : " · unclaimed"}
                </div>
              </div>
              <StatusPill code={row.statusCode} />
            </Link>
          ))}
        </TaskSection>
      ) : null}
    </main>
  );
}

function StatusPill({ code }: { code: string | null }) {
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
        statusStyles[code ?? ""] ?? "bg-slate-100 text-slate-700 border-slate-200"
      }`}
    >
      {(code ?? "").replace(/_/g, " ")}
    </span>
  );
}

function TaskSection({
  title,
  icon,
  emptyLabel,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700">
          {title}
        </h2>
      </div>
      {hasChildren ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center text-sm text-slate-400">
          {emptyLabel}
        </p>
      )}
    </section>
  );
}
