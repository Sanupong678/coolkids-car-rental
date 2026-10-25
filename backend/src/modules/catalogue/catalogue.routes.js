import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { availabilityQuery, vehicleListQuery } from "./catalogue.schemas.js";
import * as service from "./catalogue.service.js";

// Public, read-only catalogue. Short shared caching keeps the homepage and
// listing fast; availability is never cached (it changes with every booking).
const cache = (seconds) => (_req, res, next) => {
  res.set("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=${seconds * 5}`);
  next();
};

const slugParam = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/).max(120) });

export function catalogueRoutes() {
  const router = Router();

  router.get("/categories", cache(60), async (_req, res) => {
    res.json({ data: await service.categories() });
  });

  router.get("/locations", cache(300), async (_req, res) => {
    res.json({ data: await service.locations() });
  });

  router.get("/promotions", cache(60), async (_req, res) => {
    res.json({ data: await service.promotions() });
  });

  router.get("/vehicles/facets", cache(60), async (_req, res) => {
    res.json({ data: await service.facets() });
  });

  router.get("/vehicles", cache(30), validate({ query: vehicleListQuery }), async (req, res) => {
    res.json(await service.listVehicles(req.valid.query));
  });

  router.get("/vehicles/:slug", cache(60), validate({ params: slugParam }), async (req, res) => {
    res.json({ data: await service.getVehicle(req.valid.params.slug) });
  });

  router.get(
    "/vehicles/:slug/availability",
    validate({ params: slugParam, query: availabilityQuery }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      res.json({ data: await service.getAvailability(req.valid.params.slug, req.valid.query) });
    },
  );

  return router;
}
