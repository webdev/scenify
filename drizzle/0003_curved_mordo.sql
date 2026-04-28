ALTER TABLE "generation" ADD COLUMN "source_colors" jsonb;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "output_colors" jsonb;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "color_max_delta_e" real;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "color_avg_delta_e" real;