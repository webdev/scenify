ALTER TABLE "preset" ADD COLUMN "mood" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "preset" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "preset" ADD COLUMN "palette" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "preset" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "preset" ADD COLUMN "hero_image_url" text;