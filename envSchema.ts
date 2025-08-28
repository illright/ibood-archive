import {z} from "zod/v4";

export const Env = z.object({
  IBEX_LANGUAGE: z.string().default("nl"),
  IBEX_TENANT_ID: z.string(),
  IBEX_SHOP_ID: z.string(),
  USER_AGENT: z.string(),
  SEC_CH_UA: z.string(),
})
