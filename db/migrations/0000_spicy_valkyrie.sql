CREATE TABLE "default_cards" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"oracle_id" varchar(255),
	"name" varchar(500) NOT NULL,
	"set" varchar(50),
	"set_name" varchar(500),
	"collector_number" varchar(50),
	"rarity" varchar(50),
	"lang" varchar(10),
	"released_at" date,
	"frame" varchar(50),
	"border_color" varchar(50),
	"security_stamp" varchar(50),
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"oracle_id" varchar(255) PRIMARY KEY NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"tags" jsonb,
	"location" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "oracle_cards" (
	"oracle_id" varchar(255) PRIMARY KEY NOT NULL,
	"name" varchar(500) NOT NULL,
	"mana_cost" varchar(100),
	"cmc" integer,
	"type_line" varchar(500) NOT NULL,
	"oracle_text" varchar(10000),
	"colors" jsonb,
	"color_identity" jsonb,
	"keywords" jsonb,
	"legalities" jsonb
);
--> statement-breakpoint
ALTER TABLE "default_cards" ADD CONSTRAINT "default_cards_oracle_id_oracle_cards_oracle_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."oracle_cards"("oracle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_oracle_id_oracle_cards_oracle_id_fk" FOREIGN KEY ("oracle_id") REFERENCES "public"."oracle_cards"("oracle_id") ON DELETE no action ON UPDATE no action;