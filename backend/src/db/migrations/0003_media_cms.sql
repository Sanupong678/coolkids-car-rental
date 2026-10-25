-- 0003 — Media library and CMS content.
-- Files live in object storage (S3/R2/GCS); the DB holds metadata only.

CREATE TABLE media (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_type         text NOT NULL CHECK (media_type IN ('IMAGE','VIDEO','MODEL_3D','MOTION','DOCUMENT')),
  storage_provider   text NOT NULL DEFAULT 's3',
  storage_key        text NOT NULL UNIQUE,     -- object key; URLs are derived (CDN or signed)
  file_url           text,                     -- public CDN URL for public assets; NULL for private docs
  thumbnail_url      text,
  mime_type          text NOT NULL,
  file_size_bytes    bigint NOT NULL CHECK (file_size_bytes >= 0),
  width              integer CHECK (width > 0),
  height             integer CHECK (height > 0),
  duration_ms        integer CHECK (duration_ms >= 0),
  checksum_sha256    bytea,
  alt_text           text,
  is_private         boolean NOT NULL DEFAULT false,  -- contracts, ID scans → signed URLs only
  variants           jsonb NOT NULL DEFAULT '{}'::jsonb, -- responsive renditions {"w640": "...", "avif": "..."}
  uploaded_by        uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES users(id)
);
CREATE INDEX media_type_idx ON media (media_type) WHERE deleted_at IS NULL;

-- Key/value site configuration edited from the CMS: navbar, footer, theme
-- colours, typography, company info, social links. One row per key; value is
-- validated by a zod schema per key in the API.
CREATE TABLE website_content (
  key                text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]*$'),
  value              jsonb NOT NULL,
  version            integer NOT NULL DEFAULT 1,  -- optimistic concurrency for CMS edits
  updated_by         uuid REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Business configuration (tax rate, deposit policy, booking hold minutes, currency).
-- Kept apart from CMS content because different roles own it.
CREATE TABLE system_settings (
  key                text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]*$'),
  value              jsonb NOT NULL,
  version            integer NOT NULL DEFAULT 1,
  updated_by         uuid REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Ordered, typed homepage blocks: hero, category_slider, featured_vehicles,
-- why_choose_us, promotions, locations_map, ... `config` holds block settings.
CREATE TABLE homepage_sections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_type       text NOT NULL CHECK (section_type ~ '^[a-z_]+$'),
  title              text,
  subtitle           text,
  config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order         integer NOT NULL DEFAULT 0,
  is_published       boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id),
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES users(id)
);
CREATE INDEX homepage_sections_order_idx ON homepage_sections (sort_order) WHERE deleted_at IS NULL AND is_published;
CREATE TRIGGER homepage_sections_updated_at BEFORE UPDATE ON homepage_sections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Hero / promo banners. A hero section shows its active banners in order.
CREATE TABLE homepage_banners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id         uuid REFERENCES homepage_sections(id),
  headline           text NOT NULL,
  description        text,
  image_media_id     uuid REFERENCES media(id),
  video_media_id     uuid REFERENCES media(id),
  poster_media_id    uuid REFERENCES media(id),   -- still frame shown before video loads / reduced motion
  cta_primary_text   text,
  cta_primary_href   text,
  cta_secondary_text text,
  cta_secondary_href text,
  animation          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"preset":"reveal","duration_ms":1200,"parallax":true}
  sort_order         integer NOT NULL DEFAULT 0,
  starts_at          timestamptz,
  ends_at            timestamptz,
  is_published       boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id),
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES users(id),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK (cta_primary_href IS NULL OR cta_primary_href ~ '^(/|https://)'),
  CHECK (cta_secondary_href IS NULL OR cta_secondary_href ~ '^(/|https://)')
);
CREATE INDEX homepage_banners_section_idx ON homepage_banners (section_id, sort_order) WHERE deleted_at IS NULL;
CREATE TRIGGER homepage_banners_updated_at BEFORE UPDATE ON homepage_banners FOR EACH ROW EXECUTE FUNCTION set_updated_at();
