import { z } from "zod";

export const GENDERS = ["male", "female", "non_binary", "other", "prefer_not_to_say"];

export const onboardingSchema = z.object({
    age: z.coerce.number().int().min(18, "You must be at least 18").max(120),
  gender: z.enum(GENDERS),
});

export const profilePatchSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Invalid phone number").optional(),
    locale: z.enum(["en", "th", "zh"]).optional(),
    age: z.coerce.number().int().min(18, "You must be at least 18").max(120).optional(),
    gender: z.enum(GENDERS).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});
