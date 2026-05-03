ALTER TABLE "generation" ADD COLUMN "focal_point_x" real;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "focal_point_y" real;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "focal_point_confidence" real;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "focal_point_source" text;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "face_box" jsonb;