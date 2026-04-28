-- Backfill customer-facing presentation fields on Sceneify presets.
-- Source: Darkroom's scenes table (supabase/migrations/20260426000001_scenes_table.sql).
-- Idempotent: upserts on slug. Run once after migration 0005 has applied.
--
-- Hero image URLs are relative paths resolved by the consuming site
-- (Darkroom's customer browser at darkroom.tld/marketing/styles/...).
-- If Sceneify ever needs to render them itself, migrate to absolute URLs.

INSERT INTO preset (id, slug, name, description, mood, category, palette, display_order, hero_image_url)
VALUES
  (gen_random_uuid()::text, 'studio_athletic', 'Studio Athletic', '',
   'STUDIO · SOFT STROBE', 'STUDIO',
   ARRAY['#f4f0e8','#c2a37a','#8a6f4d','#3d3025','#1b1915'],
   1, '/marketing/styles/studio_athletic.jpg'),
  (gen_random_uuid()::text, 'leather_noir', 'Leather Noir', '',
   'INTERIOR · LOW KEY TUNGSTEN', 'INTERIOR',
   ARRAY['#2a2018','#5d4632','#a87b4f','#d6b380','#1b1915'],
   2, '/marketing/styles/leather_noir.jpg'),
  (gen_random_uuid()::text, 'graffiti_alley', 'Graffiti Alley', '',
   'ALLEY · BOUNCED DAYLIGHT', 'STREET',
   ARRAY['#3a4d4a','#7e8a6e','#c2a047','#d65f3f','#1f1f1d'],
   3, '/marketing/styles/graffiti_alley.jpg'),
  (gen_random_uuid()::text, 'mono_street', 'Mono Street', '',
   'STREET · OVERCAST CONCRETE', 'STREET',
   ARRAY['#cfcdc8','#9a958d','#5e5a52','#2f2c27','#1b1915'],
   4, '/marketing/styles/mono_street.jpg'),
  (gen_random_uuid()::text, 'shutter_crew', 'Shutter Crew', '',
   'ROLLUP DOORS · MORNING SUN', 'EXTERIOR',
   ARRAY['#e8d8b6','#c79755','#6f4a2a','#392418','#0f0c08'],
   5, '/marketing/styles/shutter_crew.jpg')
ON CONFLICT (slug) DO UPDATE SET
  -- Only fill the new presentation columns; preserve any existing name/description.
  mood           = EXCLUDED.mood,
  category       = EXCLUDED.category,
  palette        = EXCLUDED.palette,
  display_order  = EXCLUDED.display_order,
  hero_image_url = EXCLUDED.hero_image_url,
  updated_at     = NOW();
