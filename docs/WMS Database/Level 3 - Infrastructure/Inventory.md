The `inventory` table is the "live-balance" table. It tracks which products (SKUs) are sitting in which locations, in what quantities, and under what structural statuses. Unlike transactional tables, this table is constantly updated (`UPDATE`) by the application when items are placed or picked.

## Table Schema

| Field Name     | Type / Constraint                                                 | Description                                          |
| :------------- | :---------------------------------------------------------------- | :--------------------------------------------------- |
| `inventory_id` | `SERIAL PRIMARY KEY`                                              | Unique tracker ID for this specific stock allocation |
| `location_id`  | `INT REFERENCES locations(location_id), ON DELETE RESTRICT`       | The physical location where these items are sitting  |
| `item_id`      | `INT REFERENCES items(item_id), ON DELETE RESTRICT`               | FK pointing to the [[Items]] master record — replaces the previous raw `sku`/`product_name` strings so every stock row is guaranteed to match a real item |
| `quantity`     | `INT CHECK (quantity >= 0)`                                       | The current physical quantity at this location       |
| `batch_number` | `VARCHAR(50) NULL`                                                | Internal production/repack batch identifier, if this item is batch-tracked. `NULL` for items that aren't. |
| `lot_number`   | `VARCHAR(50) NULL`                                                | Supplier-assigned lot identifier, if provided on receipt. `NULL` for items that aren't lot-tracked. |
| `expiry_date`  | `DATE NULL`                                                       | Expiration or best-before date, if this item is perishable/shelf-life tracked. `NULL` for items that don't expire. |
| `status_id`    | `INT REFERENCES inventory_statuses(status_id) ON DELETE RESTRICT` | FK pointing to the  [[Inventory Status Types]]       |
| `updated_at`   | `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`                             | Last time this stock record was changed              |

---

## 🧠 Architectural Rules & Notes

* **Why these are nullable:** Not every item needs batch/lot/expiry tracking — a box of generic screws doesn't care, a pallet of pharmaceuticals does. Rather than a separate table split by item type, these stay as nullable columns here; [[Items]] now carries `is_batch_tracked`/`is_lot_tracked`/`has_expiry` flags so the application layer knows whether to require them per item.
* **Uniqueness constraint:**
  ```sql
  ALTER TABLE inventory
    ADD CONSTRAINT uq_inventory_location_item_batch_lot
    UNIQUE NULLS NOT DISTINCT (location_id, item_id, batch_number, lot_number);
  ```
  `NULLS NOT DISTINCT` (Postgres 15+) makes two rows with the same `location_id`/`item_id` and both `batch_number IS NULL` collide as duplicates, same as if they held a real matching value. Without it, plain `UNIQUE` treats every `NULL` as distinct from every other `NULL` — meaning two "no batch" rows for the same item/location could sit side by side unintentionally. If you're on an older Postgres version, coalesce to a sentinel (e.g. `COALESCE(batch_number, '')`) in a unique expression index instead.
* **Enforcing the `Items` flags across tables:** A plain `CHECK` constraint can't see `items.is_batch_tracked` from an `inventory` row — a `CHECK` only ever sees columns in its own row. Enforcing "if the item is batch-tracked, this row must have a `batch_number`" needs a trigger:
  ```sql
  CREATE OR REPLACE FUNCTION enforce_item_tracking_flags()
  RETURNS TRIGGER AS $$
  DECLARE
    itm items%ROWTYPE;
  BEGIN
    SELECT * INTO itm FROM items WHERE item_id = NEW.item_id;
    IF itm.is_batch_tracked AND NEW.batch_number IS NULL THEN
      RAISE EXCEPTION 'item % requires a batch_number', NEW.item_id;
    END IF;
    IF itm.is_lot_tracked AND NEW.lot_number IS NULL THEN
      RAISE EXCEPTION 'item % requires a lot_number', NEW.item_id;
    END IF;
    IF itm.has_expiry AND NEW.expiry_date IS NULL THEN
      RAISE EXCEPTION 'item % requires an expiry_date', NEW.item_id;
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER trg_inventory_tracking_flags
    BEFORE INSERT OR UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION enforce_item_tracking_flags();
  ```
  The same trigger logic (or a shared function) should be applied anywhere else `item_id` + `batch_number`/`lot_number` appear together — [[Booking Tasks]], [[Picking Tasks]], [[Replenishment Tasks]], [[Cycle Count Tasks]] — otherwise the flags on `Items` are advisory only and nothing actually stops a non-tracked value from slipping in on those tables while `Inventory` enforces it.
* **FEFO picking:** Once `expiry_date` is populated, picking logic can sort by soonest-expiry-first (FEFO) instead of the default putaway/pick strategy — that's the main operational payoff for adding this column.
