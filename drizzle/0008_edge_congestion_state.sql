CREATE TABLE "edge_congestion_state" (
	"edge_id" integer PRIMARY KEY NOT NULL,
	"warehouse_id" integer NOT NULL,
	"hall_id" integer NOT NULL,
	"smoothed_ratio" numeric(6, 3) DEFAULT '0' NOT NULL,
	"active_multiplier" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT "chk_edge_congestion_multiplier" CHECK (active_multiplier >= 1 AND active_multiplier <= 3)
);
--> statement-breakpoint
ALTER TABLE "edge_congestion_state" ADD CONSTRAINT "edge_congestion_state_edge_id_fkey" FOREIGN KEY ("edge_id") REFERENCES "public"."nav_edges"("edge_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_edge_congestion_state_warehouse" ON "edge_congestion_state" USING btree ("warehouse_id" int4_ops);