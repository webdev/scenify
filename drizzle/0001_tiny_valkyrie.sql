CREATE TABLE "generation" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"preset_id" text,
	"model" text NOT NULL,
	"requested_model" text,
	"size" text NOT NULL,
	"quality" text NOT NULL,
	"size_profile" text,
	"seed" integer,
	"register" text,
	"status" text NOT NULL,
	"constructed_prompt" text,
	"output_url" text,
	"error" text,
	"fal_endpoint" text,
	"fal_request_id" text,
	"fal_input" jsonb,
	"fal_response" jsonb,
	"created_at" timestamp with time zone DEFAULT NOW() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_product" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"blob_pathname" text,
	"filename" text NOT NULL,
	"collection" text DEFAULT '' NOT NULL,
	"sort_key" text DEFAULT '' NOT NULL,
	"bytes" integer,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;