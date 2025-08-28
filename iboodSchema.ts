import { z } from "zod/v4";

const Brand = z.object({
  id: z.string(),
  name: z.string(),
});

const Price = z.object({
  currency: z.string(),
  value: z.number(),
  cents: z.number(),
})

const Image = z.object({
  id: z.union([z.number(), z.string()]),
  slug: z.string(),
  type: z.string(),
  extension: z.string().optional(),
  priority: z.number(),
  channels: z.array(z.string()),
})

const Item = z.object({
  _id: z.string(),
  id: z.string(),
  offerId: z.string(),
  brands: z.array(Brand),
  brand: z.string(),
  classicId: z.string(),
  categories: z.array(z.string()),
  start: z.string(),
  end: z.string(),
  price: Price,
  deliveryPrice: Price,
  referencePrice: Price,
  discount: z.number(),
  appOnly: z.boolean(),
  soldOut: z.boolean(),
  freeDelivery: z.boolean(),
  directCheckout: z.boolean(),
  classicProductId: z.string(),
  slug: z.string(),
  title: z.string(),
  image: z.optional(Image),
  logo: z.optional(Image),
});

export const LiveResponseUnknown = z.object({
  data: z.object({
    items: z.array(z.record(z.string(), z.unknown())),
  }),
});

export const LiveResponse = z.object({
  data: z.object({
    items: z.array(Item),
  }),
});
