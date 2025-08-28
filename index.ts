import type { z } from "zod/v4";
import yaml from "js-yaml";
import { Env } from "./envSchema";
import { LiveResponse, LiveResponseUnknown } from "./iboodSchema";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";

const endpoint = new URL(
  "https://api.ibood.io/search/items/live?live&take=10000"
);
const productsFolder = "products";

const env = Env.parse(process.env);

const necessaryHeaders = new Headers([
  ["Ibex-Language", env.IBEX_LANGUAGE],
  ["Ibex-Tenant-Id", env.IBEX_TENANT_ID],
  ["Ibex-Shop-Id", env.IBEX_SHOP_ID],
  ["User-Agent", env.USER_AGENT],
  ["Sec-CH-UA", env.SEC_CH_UA],
  ["Accept", "application/json, text/plain, */*"],
]);

console.debug(necessaryHeaders);

async function fetchItems() {
  const response = await fetch(endpoint, {
    headers: necessaryHeaders,
  });

  if (!response.ok) {
    console.error(response.status, await response.text());
    throw new Error("Failed to fetch products");
  }

  if (!response.headers.get("content-type")?.startsWith("application/json")) {
    console.error(response.status, await response.text());
    throw new Error("Invalid content type");
  }

  const products = LiveResponseUnknown.parse(await response.json());
  products.data.items = products.data.items.filter(
    (item) => item.title !== undefined
  );
  return LiveResponse.parse(products);
}

function sanitizePath(path: string) {
  return path.replace(/[/\\?\x00-\x1F]/g, "_");
}

async function placeProducts(products: z.infer<typeof LiveResponse>) {
  return Promise.all(
    products.data.items.map((product) =>
      Bun.write(
        join(productsFolder, `${sanitizePath(product.title)}.yaml`),
        yaml.dump(product, { sortKeys: true, lineWidth: -1 })
      )
    )
  );
}

async function wipeProducts() {
  await rm(productsFolder, { recursive: true, force: true });
  await mkdir(productsFolder);
}

await wipeProducts();
const products = await fetchItems();
await placeProducts(products);
