import { resolve } from "node:path";
import type { Loader } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import yaml from "js-yaml";
import { openRepository } from "es-git";

const __dirname = new URL(".", import.meta.url).pathname;

class ProductStats {
  slug: string;
  classicId: string;
  /** Price history over time. */
  priceHistory: Array<{
    priceCents: number;
    date: Date;
  }>;
  /** "Reference price" (recommended retail price) history over time. */
  referencePriceHistory: Array<{
    priceCents: number;
    date: Date;
  }>;
  presenceHistory: Array<{ date: Date; isSoldOut: boolean }>;

  constructor(slug: string, classicId: string) {
    this.slug = slug;
    this.classicId = classicId;
    this.priceHistory = [];
    this.referencePriceHistory = [];
    this.presenceHistory = [];
  }

  markPresent(date: Date, isSoldOut: boolean) {
    this.presenceHistory.push({ date, isSoldOut });
  }

  setPriceCents(date: Date, priceCents: number) {
    this.priceHistory.push({ date, priceCents });
  }

  setReferencePriceCents(date: Date, referencePriceCents: number) {
    this.referencePriceHistory.push({ date, priceCents: referencePriceCents });
  }

  getPresenceRanges(earliestDate: Date) {
    this.presenceHistory.sort((a, b) => a.date.valueOf() - b.date.valueOf());
    // semi-open ranges (start inclusive, end exclusive)
    const ranges: Array<{
      type: "present" | "soldOut" | "absent";
      start: Date;
      end: Date;
    }> = [];

    if (
      this.presenceHistory.length === 0 ||
      this.presenceHistory[0].date.valueOf() > earliestDate.valueOf()
    ) {
      ranges.push({
        type: "absent",
        start: earliestDate,
        end:
          this.presenceHistory.length > 0
            ? this.presenceHistory[0].date
            : tomorrow(),
      });
    }

    let currentRange: { type: "present" | "soldOut"; start: Date } | null =
      null;

    for (const entry of this.presenceHistory) {
      const entryType = entry.isSoldOut ? "soldOut" : "present";
      if (currentRange === null) {
        currentRange = { type: entryType, start: entry.date };
      } else if (currentRange.type !== entryType) {
        ranges.push({
          type: currentRange.type,
          start: currentRange.start,
          end: entry.date,
        });
        currentRange = { type: entryType, start: entry.date };
      }
    }

    if (currentRange !== null) {
      ranges.push({
        type: currentRange.type,
        start: currentRange.start,
        end: tomorrow(), // up to now
      });
    }

    return ranges;
  }

  // Logic duplicated from getPresenceRanges
  getPriceHistory() {
    this.priceHistory.sort((a, b) => a.date.valueOf() - b.date.valueOf());
    this.referencePriceHistory.sort(
      (a, b) => a.date.valueOf() - b.date.valueOf()
    );

    // semi-open ranges (start inclusive, end exclusive)
    const ranges: Array<{
      priceCents: number;
      referencePriceCents: number;
      start: Date;
      end: Date;
    }> = [];

    let currentRange: {
      priceCents: number;
      referencePriceCents: number;
      start: Date;
    } | null = null;

    for (const [priceEntry, referenceEntry] of zip(
      this.priceHistory,
      this.referencePriceHistory
    )) {
      if (priceEntry.date.valueOf() !== referenceEntry.date.valueOf()) {
        throw new Error(
          `Mismatched price and reference price dates: ${priceEntry.date.toISOString()} vs ${referenceEntry.date.toISOString()}`
        );
      }

      if (currentRange === null) {
        currentRange = {
          priceCents: priceEntry.priceCents,
          referencePriceCents: referenceEntry.priceCents,
          start: priceEntry.date,
        };
      } else if (
        currentRange.priceCents !== priceEntry.priceCents ||
        currentRange.referencePriceCents !== referenceEntry.priceCents
      ) {
        ranges.push({
          priceCents: currentRange.priceCents,
          referencePriceCents: currentRange.referencePriceCents,
          start: currentRange.start,
          end: priceEntry.date,
        });
        currentRange = {
          priceCents: priceEntry.priceCents,
          referencePriceCents: referenceEntry.priceCents,
          start: priceEntry.date,
        };
      }
    }

    if (currentRange !== null) {
      ranges.push({
        priceCents: currentRange.priceCents,
        referencePriceCents: currentRange.referencePriceCents,
        start: currentRange.start,
        end: tomorrow(), // up to now
      });
    }

    return ranges;
  }
}

function productLoader({
  branch = "archive",
} = {}): Loader {
  const ProductDisplayData = z.object({
    originalUrl: z.string().url(),
    presenceRanges: z.array(
      z.object({
        type: z.enum(["present", "soldOut", "absent"]),
        start: z.string().date(),
        end: z.string().date(),
      })
    ),
    priceHistory: z.array(
      z.object({
        priceCents: z.number().int(),
        referencePriceCents: z.number().int(),
        start: z.string().date(),
        end: z.string().date(),
      })
    ),
  });

  const ProductSnapshotData = z.object({
    price: z.object({
      cents: z.number().int(),
      currency: z.literal("EUR"),
    }),
    referencePrice: z.object({
      cents: z.number().int(),
      currency: z.literal("EUR"),
    }),
    soldOut: z.boolean(),
    slug: z.string(),
    classicId: z.string(),
  });

  return {
    name: "product-loader",
    schema: ProductDisplayData,
    load: async ({ store, parseData }) => {
      const repo = await openRepository(resolve(__dirname, "../.."));
      const lastCommit = repo.getBranch(branch, "Local").referenceTarget();
      if (lastCommit === null) {
        throw new Error(`Branch ${branch} has no commits`);
      }

      const allProductsEver = new Map<string, ProductStats>();
      let earliestDate: Date = new Date();
      for (const commitSha of repo.revwalk().push(lastCommit)) {
        const commit = repo.getCommit(commitSha);
        const recordDateString = commit.message().match(/^[0-9-]+/);
        if (recordDateString === null) {
          console.warn(
            `Skipping commit ${commitSha}, couldn't parse a date from its message: ${commit.message()}`
          );
          continue;
        }
        const recordDate = new Date(recordDateString[0]);
        if (recordDate.valueOf() < earliestDate.valueOf()) {
          earliestDate = recordDate;
        }

        commit.tree().walk("PreOrder", (entry) => {
          const name = entry.name();
          if (entry.type() === "Blob") {
            const fileContent = new TextDecoder().decode(
              entry.toObject(repo).peelToBlob().content()
            );
            const productData = ProductSnapshotData.parse(
              yaml.load(fileContent)
            );

            const stats =
              allProductsEver.get(name) ??
              new ProductStats(productData.slug, productData.classicId);

            stats.markPresent(recordDate, productData.soldOut);
            stats.setPriceCents(recordDate, productData.price.cents);
            stats.setReferencePriceCents(
              recordDate,
              productData.referencePrice.cents
            );
            allProductsEver.set(name, stats);
          }
          return 0;
        });
      }

      for (const [productName, stats] of allProductsEver) {
        const id = productName.slice(0, -".yaml".length);
        if (id.length === 0) {
          continue;
        }

        const product = {
          id,
          data: {
            originalUrl: `https://ibood.com/nl/s-nl/o/${stats.slug}/${stats.classicId}`,
            presenceRanges: stats.getPresenceRanges(earliestDate).map((range) => ({
              type: range.type,
              start: range.start.toISOString().slice(0, 'YYYY-MM-DD'.length),
              end: range.end.toISOString().slice(0, 'YYYY-MM-DD'.length),
            })),
            priceHistory: stats.getPriceHistory().map((range) => ({
              priceCents: range.priceCents,
              referencePriceCents: range.referencePriceCents,
              start: range.start.toISOString().slice(0, 'YYYY-MM-DD'.length),
              end: range.end.toISOString().slice(0, 'YYYY-MM-DD'.length),
            })),
          },
        };

        try {
          store.set({ id, data: await parseData(product) });
        } catch (e) {
          console.error(`Error parsing ${productName}:`, {
            product,
          });
          throw e;
        }
      }
    },
  };
}

function tomorrow() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

const products = defineCollection({
  loader: productLoader(),
});

export const collections = { products };

function* zip<T, U>(a: T[], b: U[]): Iterable<[T, U]> {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    yield [a[i], b[i]];
  }
}
