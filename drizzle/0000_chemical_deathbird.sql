CREATE TABLE "preset" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT NOW() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT NOW() NOT NULL,
	CONSTRAINT "preset_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "preset_image" (
	"id" text PRIMARY KEY NOT NULL,
	"preset_id" text NOT NULL,
	"url" text NOT NULL,
	"blob_pathname" text,
	"filename" text,
	"sort_key" text DEFAULT '' NOT NULL,
	"cached_prompt" text,
	"bytes" integer,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preset_image" ADD CONSTRAINT "preset_image_preset_id_preset_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."preset"("id") ON DELETE cascade ON UPDATE no action;