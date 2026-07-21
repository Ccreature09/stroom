# 🏗️ Physical Entity Glossary

A quick reference for the real-world objects this WMS models, and which table each one lives in. Use this alongside [[Database structure|the Database Schema Blueprint]] when the table names alone aren't self-explanatory.

## Tenant & People

| Physical thing | Table | Notes |
| :--- | :--- | :--- |
| A client company using the platform (e.g., "Stryker") | [[Organizations]] | The root of every tenant boundary. |
| A physical fulfillment building | [[Warehouses]] | Owned by exactly one organization. |
| A worker (picker, driver, supervisor, admin) | [[Employees]] | Has a `primary_warehouse_id` (home base) and `current_warehouse_id` (where they're clocked in right now). |
| A worker's operating license (forklift, reach truck, EPT) | [[Employee Licenses]] | Bridge between [[Employees]] and [[MHE Types]]. |
| A shift attendance record | [[Time Clock Entries]] | Append-only clock-in/clock-out ledger. |

## Building Layout

| Physical thing | Table | Notes |
| :--- | :--- | :--- |
| A storage slot, rack shelf, or dock door | [[Locations]] | Every scannable spot in the building, including dock doors and staging lanes. |
| A functional area (bulk storage, chilled, hazmat, dock staging) | [[Zone Types]] | Groups locations by operational rules (pickable, temperature-controlled, hazmat clearance). |
| An operational division of workers (Picking, Receiving) | [[Departments]] | Routes tasks to groups of people, not physical space. |

## Goods & Containers

| Physical thing | Table | Notes |
| :--- | :--- | :--- |
| A product/SKU definition | [[Items]] | Dimensions, weight, hazard class, batch/lot/expiry tracking flags. |
| A physical pallet, tote, or carton (LPN) | [[Pallets]] | The scannable container that moves through unload → putaway → pick → load. |
| A live stock balance (item + location + quantity) | [[Inventory]] | Constantly updated as stock moves. |
| A single scan/click of stock moving | [[Stock Movements]] | Immutable audit ledger — never updated or deleted. |

## Trading Partners

| Physical thing | Table | Notes |
| :--- | :--- | :--- |
| A vendor who ships goods in | [[Suppliers]] | Tenant-scoped master data. |
| A customer/retail destination goods ship to | [[Customers]] | Tenant-scoped master data. |
| A freight/shipping provider | [[Carriers]] | Tenant-scoped master data. |

## Documents & Dispatch

| Physical thing | Table | Notes |
| :--- | :--- | :--- |
| An inbound order to a supplier | [[Purchase Orders]] / [[Purchase Order Lines]] | Header + line items. |
| An outbound order from a customer | [[Sales Orders]] / [[Sales Order Lines]] | Header + line items. |
| A physical trailer-load leaving the dock | [[Shipments]] | Can consolidate multiple sales orders. |

## Machinery & Access

| Physical thing | Table | Notes |
| :--- | :--- | :--- |
| A class of warehouse equipment (forklift, reach truck) | [[MHE Types]] | Defines weight/reach limits and license requirements. |
| A job role (Picker, Supervisor, Admin) | [[Position Types]] | Defines system permissions, not physical equipment. |
