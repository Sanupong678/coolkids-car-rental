import { Router } from "express";
import { pool } from "../../db/pool.js";

// Public CMS reads. Writes arrive with the Admin Dashboard (Phase 8).
export function contentRoutes() {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    next();
  });

  // navbar, footer, theme, company — one round trip for the app shell.
  router.get("/site", async (_req, res) => {
    const { rows } = await pool.query("SELECT key, value FROM website_content WHERE key LIKE 'site.%'");
    res.json({ data: Object.fromEntries(rows.map((r) => [r.key.slice(5), r.value])) });
  });

  // Published homepage sections in order, each with its live banners.
  router.get("/homepage", async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.section_type AS type, s.title, s.subtitle, s.config,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', b.id, 'headline', b.headline, 'description', b.description,
                         'image', img.file_url, 'video', vid.file_url, 'poster', pos.file_url,
                         'ctaPrimary', json_build_object('text', b.cta_primary_text, 'href', b.cta_primary_href),
                         'ctaSecondary', json_build_object('text', b.cta_secondary_text, 'href', b.cta_secondary_href),
                         'animation', b.animation) ORDER BY b.sort_order)
                  FROM homepage_banners b
                  LEFT JOIN media img ON img.id = b.image_media_id
                  LEFT JOIN media vid ON vid.id = b.video_media_id
                  LEFT JOIN media pos ON pos.id = b.poster_media_id
                 WHERE b.section_id = s.id AND b.is_published AND b.deleted_at IS NULL
                   AND (b.starts_at IS NULL OR b.starts_at <= now()) AND (b.ends_at IS NULL OR b.ends_at > now())
              ), '[]') AS banners
         FROM homepage_sections s
        WHERE s.is_published AND s.deleted_at IS NULL
        ORDER BY s.sort_order`,
    );
    res.json({ data: rows });
  });

  return router;
}
