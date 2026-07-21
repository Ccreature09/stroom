import { relations } from "drizzle-orm/relations";
import { warehouseConfigs, warehouses, organizations, users, employees, positionTypes, items, customers, suppliers, carriers, purchaseOrders, salesOrders, shipments, inventoryStatuses, departments, inventory, locations, pallets, purchaseOrderLines, salesOrderLines, stockMovements, tasks, mheTypes, taskStatuses, taskTypes, bookingTasks, putawayTasks, unloadingTasks, pickingTasks, loadingTasks, replenishmentTasks, cycleCountTasks, timeClockEntries, halls, zoneTypes, shipmentSalesOrders, taskEligibleDepartments, employeeDepartments, employeeLicenses } from "./schema";

export const warehousesRelations = relations(warehouses, ({one, many}) => ({
	warehouseConfig: one(warehouseConfigs, {
		fields: [warehouses.configId],
		references: [warehouseConfigs.configId]
	}),
	organization: one(organizations, {
		fields: [warehouses.organizationId],
		references: [organizations.organizationId]
	}),
	employees_currentWarehouseId: many(employees, {
		relationName: "employees_currentWarehouseId_warehouses_warehouseId"
	}),
	employees_primaryWarehouseId: many(employees, {
		relationName: "employees_primaryWarehouseId_warehouses_warehouseId"
	}),
	employees_organizationId: many(employees, {
		relationName: "employees_organizationId_warehouses_warehouseId"
	}),
	purchaseOrders_organizationId: many(purchaseOrders, {
		relationName: "purchaseOrders_organizationId_warehouses_warehouseId"
	}),
	purchaseOrders_warehouseId: many(purchaseOrders, {
		relationName: "purchaseOrders_warehouseId_warehouses_warehouseId"
	}),
	salesOrders_organizationId: many(salesOrders, {
		relationName: "salesOrders_organizationId_warehouses_warehouseId"
	}),
	salesOrders_warehouseId: many(salesOrders, {
		relationName: "salesOrders_warehouseId_warehouses_warehouseId"
	}),
	shipments_organizationId: many(shipments, {
		relationName: "shipments_organizationId_warehouses_warehouseId"
	}),
	shipments_warehouseId: many(shipments, {
		relationName: "shipments_warehouseId_warehouses_warehouseId"
	}),
	departments: many(departments),
	pallets: many(pallets),
	tasks: many(tasks),
	timeClockEntries: many(timeClockEntries),
	positionTypes: many(positionTypes),
	halls: many(halls),
	locations: many(locations),
	zoneTypes: many(zoneTypes),
}));

export const warehouseConfigsRelations = relations(warehouseConfigs, ({many}) => ({
	warehouses: many(warehouses),
}));

export const organizationsRelations = relations(organizations, ({many}) => ({
	warehouses: many(warehouses),
	employees: many(employees),
	items: many(items),
	customers: many(customers),
	suppliers: many(suppliers),
	carriers: many(carriers),
	purchaseOrders: many(purchaseOrders),
	salesOrders: many(salesOrders),
	shipments: many(shipments),
	inventoryStatuses: many(inventoryStatuses),
}));

export const employeesRelations = relations(employees, ({one, many}) => ({
	users: one(users, {
		fields: [employees.authUserId],
		references: [users.id]
	}),
	warehouse_currentWarehouseId: one(warehouses, {
		fields: [employees.currentWarehouseId],
		references: [warehouses.warehouseId],
		relationName: "employees_currentWarehouseId_warehouses_warehouseId"
	}),
	organization: one(organizations, {
		fields: [employees.organizationId],
		references: [organizations.organizationId]
	}),
	positionType: one(positionTypes, {
		fields: [employees.positionId],
		references: [positionTypes.positionId]
	}),
	warehouse_primaryWarehouseId: one(warehouses, {
		fields: [employees.primaryWarehouseId],
		references: [warehouses.warehouseId],
		relationName: "employees_primaryWarehouseId_warehouses_warehouseId"
	}),
	warehouse_organizationId: one(warehouses, {
		fields: [employees.organizationId],
		references: [warehouses.warehouseId],
		relationName: "employees_organizationId_warehouses_warehouseId"
	}),
	stockMovements: many(stockMovements),
	tasks: many(tasks),
	timeClockEntries_editedByEmployeeId: many(timeClockEntries, {
		relationName: "timeClockEntries_editedByEmployeeId_employees_employeeId"
	}),
	timeClockEntries_employeeId: many(timeClockEntries, {
		relationName: "timeClockEntries_employeeId_employees_employeeId"
	}),
	employeeDepartments: many(employeeDepartments),
	employeeLicenses: many(employeeLicenses),
}));

export const usersInAuthRelations = relations(users, ({many}) => ({
	employees: many(employees),
}));

export const positionTypesRelations = relations(positionTypes, ({one, many}) => ({
	employees: many(employees),
	warehouse: one(warehouses, {
		fields: [positionTypes.warehouseId],
		references: [warehouses.warehouseId]
	}),
}));

export const itemsRelations = relations(items, ({one, many}) => ({
	organization: one(organizations, {
		fields: [items.organizationId],
		references: [organizations.organizationId]
	}),
	inventories: many(inventory),
	purchaseOrderLines: many(purchaseOrderLines),
	salesOrderLines: many(salesOrderLines),
	stockMovements: many(stockMovements),
	bookingTasks: many(bookingTasks),
	pickingTasks: many(pickingTasks),
	replenishmentTasks: many(replenishmentTasks),
	cycleCountTasks: many(cycleCountTasks),
}));

export const customersRelations = relations(customers, ({one, many}) => ({
	organization: one(organizations, {
		fields: [customers.organizationId],
		references: [organizations.organizationId]
	}),
	salesOrders_organizationId: many(salesOrders, {
		relationName: "salesOrders_organizationId_customers_customerId"
	}),
	salesOrders_customerId: many(salesOrders, {
		relationName: "salesOrders_customerId_customers_customerId"
	}),
}));

export const suppliersRelations = relations(suppliers, ({one, many}) => ({
	organization: one(organizations, {
		fields: [suppliers.organizationId],
		references: [organizations.organizationId]
	}),
	purchaseOrders_organizationId: many(purchaseOrders, {
		relationName: "purchaseOrders_organizationId_suppliers_supplierId"
	}),
	purchaseOrders_supplierId: many(purchaseOrders, {
		relationName: "purchaseOrders_supplierId_suppliers_supplierId"
	}),
}));

export const carriersRelations = relations(carriers, ({one, many}) => ({
	organization: one(organizations, {
		fields: [carriers.organizationId],
		references: [organizations.organizationId]
	}),
	salesOrders_organizationId: many(salesOrders, {
		relationName: "salesOrders_organizationId_carriers_carrierId"
	}),
	salesOrders_carrierId: many(salesOrders, {
		relationName: "salesOrders_carrierId_carriers_carrierId"
	}),
	shipments_organizationId: many(shipments, {
		relationName: "shipments_organizationId_carriers_carrierId"
	}),
	shipments_carrierId: many(shipments, {
		relationName: "shipments_carrierId_carriers_carrierId"
	}),
	unloadingTasks: many(unloadingTasks),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({one, many}) => ({
	supplier_organizationId: one(suppliers, {
		fields: [purchaseOrders.organizationId],
		references: [suppliers.supplierId],
		relationName: "purchaseOrders_organizationId_suppliers_supplierId"
	}),
	warehouse_organizationId: one(warehouses, {
		fields: [purchaseOrders.organizationId],
		references: [warehouses.warehouseId],
		relationName: "purchaseOrders_organizationId_warehouses_warehouseId"
	}),
	organization: one(organizations, {
		fields: [purchaseOrders.organizationId],
		references: [organizations.organizationId]
	}),
	supplier_supplierId: one(suppliers, {
		fields: [purchaseOrders.supplierId],
		references: [suppliers.supplierId],
		relationName: "purchaseOrders_supplierId_suppliers_supplierId"
	}),
	warehouse_warehouseId: one(warehouses, {
		fields: [purchaseOrders.warehouseId],
		references: [warehouses.warehouseId],
		relationName: "purchaseOrders_warehouseId_warehouses_warehouseId"
	}),
	purchaseOrderLines: many(purchaseOrderLines),
}));

export const salesOrdersRelations = relations(salesOrders, ({one, many}) => ({
	carrier_organizationId: one(carriers, {
		fields: [salesOrders.organizationId],
		references: [carriers.carrierId],
		relationName: "salesOrders_organizationId_carriers_carrierId"
	}),
	customer_organizationId: one(customers, {
		fields: [salesOrders.organizationId],
		references: [customers.customerId],
		relationName: "salesOrders_organizationId_customers_customerId"
	}),
	warehouse_organizationId: one(warehouses, {
		fields: [salesOrders.organizationId],
		references: [warehouses.warehouseId],
		relationName: "salesOrders_organizationId_warehouses_warehouseId"
	}),
	carrier_carrierId: one(carriers, {
		fields: [salesOrders.carrierId],
		references: [carriers.carrierId],
		relationName: "salesOrders_carrierId_carriers_carrierId"
	}),
	customer_customerId: one(customers, {
		fields: [salesOrders.customerId],
		references: [customers.customerId],
		relationName: "salesOrders_customerId_customers_customerId"
	}),
	organization: one(organizations, {
		fields: [salesOrders.organizationId],
		references: [organizations.organizationId]
	}),
	warehouse_warehouseId: one(warehouses, {
		fields: [salesOrders.warehouseId],
		references: [warehouses.warehouseId],
		relationName: "salesOrders_warehouseId_warehouses_warehouseId"
	}),
	salesOrderLines: many(salesOrderLines),
	shipmentSalesOrders: many(shipmentSalesOrders),
}));

export const shipmentsRelations = relations(shipments, ({one, many}) => ({
	carrier_organizationId: one(carriers, {
		fields: [shipments.organizationId],
		references: [carriers.carrierId],
		relationName: "shipments_organizationId_carriers_carrierId"
	}),
	warehouse_organizationId: one(warehouses, {
		fields: [shipments.organizationId],
		references: [warehouses.warehouseId],
		relationName: "shipments_organizationId_warehouses_warehouseId"
	}),
	carrier_carrierId: one(carriers, {
		fields: [shipments.carrierId],
		references: [carriers.carrierId],
		relationName: "shipments_carrierId_carriers_carrierId"
	}),
	organization: one(organizations, {
		fields: [shipments.organizationId],
		references: [organizations.organizationId]
	}),
	warehouse_warehouseId: one(warehouses, {
		fields: [shipments.warehouseId],
		references: [warehouses.warehouseId],
		relationName: "shipments_warehouseId_warehouses_warehouseId"
	}),
	loadingTasks: many(loadingTasks),
	shipmentSalesOrders: many(shipmentSalesOrders),
}));

export const inventoryStatusesRelations = relations(inventoryStatuses, ({one, many}) => ({
	organization: one(organizations, {
		fields: [inventoryStatuses.organizationId],
		references: [organizations.organizationId]
	}),
	inventories: many(inventory),
}));

export const departmentsRelations = relations(departments, ({one, many}) => ({
	warehouse: one(warehouses, {
		fields: [departments.warehouseId],
		references: [warehouses.warehouseId]
	}),
	taskEligibleDepartments: many(taskEligibleDepartments),
	employeeDepartments: many(employeeDepartments),
}));

export const inventoryRelations = relations(inventory, ({one}) => ({
	item: one(items, {
		fields: [inventory.itemId],
		references: [items.itemId]
	}),
	location: one(locations, {
		fields: [inventory.locationId],
		references: [locations.locationId]
	}),
	inventoryStatus: one(inventoryStatuses, {
		fields: [inventory.statusId],
		references: [inventoryStatuses.statusId]
	}),
}));

export const locationsRelations = relations(locations, ({one, many}) => ({
	inventories: many(inventory),
	pallets: many(pallets),
	stockMovements_destinationLocationId: many(stockMovements, {
		relationName: "stockMovements_destinationLocationId_locations_locationId"
	}),
	stockMovements_sourceLocationId: many(stockMovements, {
		relationName: "stockMovements_sourceLocationId_locations_locationId"
	}),
	bookingTasks: many(bookingTasks),
	putawayTasks_actualDestLocationId: many(putawayTasks, {
		relationName: "putawayTasks_actualDestLocationId_locations_locationId"
	}),
	putawayTasks_sourceLocationId: many(putawayTasks, {
		relationName: "putawayTasks_sourceLocationId_locations_locationId"
	}),
	putawayTasks_suggestedDestLocationId: many(putawayTasks, {
		relationName: "putawayTasks_suggestedDestLocationId_locations_locationId"
	}),
	unloadingTasks: many(unloadingTasks),
	pickingTasks: many(pickingTasks),
	loadingTasks: many(loadingTasks),
	replenishmentTasks_destinationLocationId: many(replenishmentTasks, {
		relationName: "replenishmentTasks_destinationLocationId_locations_locationId"
	}),
	replenishmentTasks_sourceLocationId: many(replenishmentTasks, {
		relationName: "replenishmentTasks_sourceLocationId_locations_locationId"
	}),
	cycleCountTasks: many(cycleCountTasks),
	hall: one(halls, {
		fields: [locations.hallId],
		references: [halls.hallId]
	}),
	warehouse: one(warehouses, {
		fields: [locations.warehouseId],
		references: [warehouses.warehouseId]
	}),
	zoneType: one(zoneTypes, {
		fields: [locations.zoneId],
		references: [zoneTypes.zoneId]
	}),
}));

export const palletsRelations = relations(pallets, ({one, many}) => ({
	location: one(locations, {
		fields: [pallets.currentLocationId],
		references: [locations.locationId]
	}),
	warehouse: one(warehouses, {
		fields: [pallets.warehouseId],
		references: [warehouses.warehouseId]
	}),
	putawayTasks: many(putawayTasks),
	pickingTasks: many(pickingTasks),
	loadingTasks: many(loadingTasks),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({one}) => ({
	item: one(items, {
		fields: [purchaseOrderLines.itemId],
		references: [items.itemId]
	}),
	purchaseOrder: one(purchaseOrders, {
		fields: [purchaseOrderLines.poId],
		references: [purchaseOrders.poId]
	}),
}));

export const salesOrderLinesRelations = relations(salesOrderLines, ({one}) => ({
	item: one(items, {
		fields: [salesOrderLines.itemId],
		references: [items.itemId]
	}),
	salesOrder: one(salesOrders, {
		fields: [salesOrderLines.soId],
		references: [salesOrders.soId]
	}),
}));

export const stockMovementsRelations = relations(stockMovements, ({one}) => ({
	location_destinationLocationId: one(locations, {
		fields: [stockMovements.destinationLocationId],
		references: [locations.locationId],
		relationName: "stockMovements_destinationLocationId_locations_locationId"
	}),
	employee: one(employees, {
		fields: [stockMovements.employeeId],
		references: [employees.employeeId]
	}),
	item: one(items, {
		fields: [stockMovements.itemId],
		references: [items.itemId]
	}),
	location_sourceLocationId: one(locations, {
		fields: [stockMovements.sourceLocationId],
		references: [locations.locationId],
		relationName: "stockMovements_sourceLocationId_locations_locationId"
	}),
}));

export const tasksRelations = relations(tasks, ({one, many}) => ({
	employee: one(employees, {
		fields: [tasks.assignedEmployeeId],
		references: [employees.employeeId]
	}),
	mheType: one(mheTypes, {
		fields: [tasks.mheTypeRequired],
		references: [mheTypes.mheTypeId]
	}),
	taskStatus: one(taskStatuses, {
		fields: [tasks.statusId],
		references: [taskStatuses.statusId]
	}),
	taskType: one(taskTypes, {
		fields: [tasks.taskTypeId],
		references: [taskTypes.taskTypeId]
	}),
	warehouse: one(warehouses, {
		fields: [tasks.warehouseId],
		references: [warehouses.warehouseId]
	}),
	bookingTasks: many(bookingTasks),
	putawayTasks: many(putawayTasks),
	unloadingTasks: many(unloadingTasks),
	pickingTasks: many(pickingTasks),
	loadingTasks: many(loadingTasks),
	replenishmentTasks: many(replenishmentTasks),
	cycleCountTasks: many(cycleCountTasks),
	taskEligibleDepartments: many(taskEligibleDepartments),
}));

export const mheTypesRelations = relations(mheTypes, ({many}) => ({
	tasks: many(tasks),
	employeeLicenses: many(employeeLicenses),
}));

export const taskStatusesRelations = relations(taskStatuses, ({many}) => ({
	tasks: many(tasks),
}));

export const taskTypesRelations = relations(taskTypes, ({many}) => ({
	tasks: many(tasks),
}));

export const bookingTasksRelations = relations(bookingTasks, ({one}) => ({
	location: one(locations, {
		fields: [bookingTasks.dockDoorLocationId],
		references: [locations.locationId]
	}),
	item: one(items, {
		fields: [bookingTasks.itemId],
		references: [items.itemId]
	}),
	task: one(tasks, {
		fields: [bookingTasks.taskId],
		references: [tasks.taskId]
	}),
}));

export const putawayTasksRelations = relations(putawayTasks, ({one}) => ({
	location_actualDestLocationId: one(locations, {
		fields: [putawayTasks.actualDestLocationId],
		references: [locations.locationId],
		relationName: "putawayTasks_actualDestLocationId_locations_locationId"
	}),
	pallet: one(pallets, {
		fields: [putawayTasks.lpnId],
		references: [pallets.lpnId]
	}),
	location_sourceLocationId: one(locations, {
		fields: [putawayTasks.sourceLocationId],
		references: [locations.locationId],
		relationName: "putawayTasks_sourceLocationId_locations_locationId"
	}),
	location_suggestedDestLocationId: one(locations, {
		fields: [putawayTasks.suggestedDestLocationId],
		references: [locations.locationId],
		relationName: "putawayTasks_suggestedDestLocationId_locations_locationId"
	}),
	task: one(tasks, {
		fields: [putawayTasks.taskId],
		references: [tasks.taskId]
	}),
}));

export const unloadingTasksRelations = relations(unloadingTasks, ({one}) => ({
	carrier: one(carriers, {
		fields: [unloadingTasks.carrierId],
		references: [carriers.carrierId]
	}),
	location: one(locations, {
		fields: [unloadingTasks.dockDoorLocationId],
		references: [locations.locationId]
	}),
	task: one(tasks, {
		fields: [unloadingTasks.taskId],
		references: [tasks.taskId]
	}),
}));

export const pickingTasksRelations = relations(pickingTasks, ({one}) => ({
	item: one(items, {
		fields: [pickingTasks.itemId],
		references: [items.itemId]
	}),
	pallet: one(pallets, {
		fields: [pickingTasks.lpnId],
		references: [pallets.lpnId]
	}),
	location: one(locations, {
		fields: [pickingTasks.pickLocationId],
		references: [locations.locationId]
	}),
	task: one(tasks, {
		fields: [pickingTasks.taskId],
		references: [tasks.taskId]
	}),
}));

export const loadingTasksRelations = relations(loadingTasks, ({one}) => ({
	location: one(locations, {
		fields: [loadingTasks.dockDoorLocationId],
		references: [locations.locationId]
	}),
	pallet: one(pallets, {
		fields: [loadingTasks.lpnId],
		references: [pallets.lpnId]
	}),
	shipment: one(shipments, {
		fields: [loadingTasks.shipmentId],
		references: [shipments.shipmentId]
	}),
	task: one(tasks, {
		fields: [loadingTasks.taskId],
		references: [tasks.taskId]
	}),
}));

export const replenishmentTasksRelations = relations(replenishmentTasks, ({one}) => ({
	location_destinationLocationId: one(locations, {
		fields: [replenishmentTasks.destinationLocationId],
		references: [locations.locationId],
		relationName: "replenishmentTasks_destinationLocationId_locations_locationId"
	}),
	item: one(items, {
		fields: [replenishmentTasks.itemId],
		references: [items.itemId]
	}),
	location_sourceLocationId: one(locations, {
		fields: [replenishmentTasks.sourceLocationId],
		references: [locations.locationId],
		relationName: "replenishmentTasks_sourceLocationId_locations_locationId"
	}),
	task: one(tasks, {
		fields: [replenishmentTasks.taskId],
		references: [tasks.taskId]
	}),
}));

export const cycleCountTasksRelations = relations(cycleCountTasks, ({one}) => ({
	item: one(items, {
		fields: [cycleCountTasks.itemId],
		references: [items.itemId]
	}),
	location: one(locations, {
		fields: [cycleCountTasks.locationId],
		references: [locations.locationId]
	}),
	task: one(tasks, {
		fields: [cycleCountTasks.taskId],
		references: [tasks.taskId]
	}),
}));

export const timeClockEntriesRelations = relations(timeClockEntries, ({one}) => ({
	employee_editedByEmployeeId: one(employees, {
		fields: [timeClockEntries.editedByEmployeeId],
		references: [employees.employeeId],
		relationName: "timeClockEntries_editedByEmployeeId_employees_employeeId"
	}),
	employee_employeeId: one(employees, {
		fields: [timeClockEntries.employeeId],
		references: [employees.employeeId],
		relationName: "timeClockEntries_employeeId_employees_employeeId"
	}),
	warehouse: one(warehouses, {
		fields: [timeClockEntries.warehouseId],
		references: [warehouses.warehouseId]
	}),
}));

export const hallsRelations = relations(halls, ({one, many}) => ({
	warehouse: one(warehouses, {
		fields: [halls.organizationId],
		references: [warehouses.warehouseId]
	}),
	locations: many(locations),
}));

export const zoneTypesRelations = relations(zoneTypes, ({one, many}) => ({
	locations: many(locations),
	warehouse: one(warehouses, {
		fields: [zoneTypes.warehouseId],
		references: [warehouses.warehouseId]
	}),
}));

export const shipmentSalesOrdersRelations = relations(shipmentSalesOrders, ({one}) => ({
	shipment: one(shipments, {
		fields: [shipmentSalesOrders.shipmentId],
		references: [shipments.shipmentId]
	}),
	salesOrder: one(salesOrders, {
		fields: [shipmentSalesOrders.soId],
		references: [salesOrders.soId]
	}),
}));

export const taskEligibleDepartmentsRelations = relations(taskEligibleDepartments, ({one}) => ({
	department: one(departments, {
		fields: [taskEligibleDepartments.departmentId],
		references: [departments.departmentId]
	}),
	task: one(tasks, {
		fields: [taskEligibleDepartments.taskId],
		references: [tasks.taskId]
	}),
}));

export const employeeDepartmentsRelations = relations(employeeDepartments, ({one}) => ({
	department: one(departments, {
		fields: [employeeDepartments.departmentId],
		references: [departments.departmentId]
	}),
	employee: one(employees, {
		fields: [employeeDepartments.employeeId],
		references: [employees.employeeId]
	}),
}));

export const employeeLicensesRelations = relations(employeeLicenses, ({one}) => ({
	employee: one(employees, {
		fields: [employeeLicenses.employeeId],
		references: [employees.employeeId]
	}),
	mheType: one(mheTypes, {
		fields: [employeeLicenses.mheTypeId],
		references: [mheTypes.mheTypeId]
	}),
}));