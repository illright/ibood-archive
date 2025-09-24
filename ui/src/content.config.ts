import type { Loader } from "astro/loaders";
import { defineCollection, z } from "astro:content";

function productLoader({
  branch = "archive",
  pathPrefix = "products/",
} = {}): Loader {
  const schema = z.object({
    firstAppearance: z.string().date(),
    absenceRanges: z.array(
      z.object({
        start: z.string().date(),
        end: z.string().date().or(z.undefined()),
      })
    ),
  });

  return {
    name: "product-loader",
    schema,
    load: async ({ store, parseData }) => {
      const allProductsEverStdout = await Bun.$`git log ${branch} --pretty=format: --name-only --diff-filter=A`.cwd('..').text()
      const allProductsEver = [...new Set(allProductsEverStdout.split("\n"))]
        .filter((line) => line.length > 0)
        .map((line) => {
          if (line.startsWith('"') && line.endsWith('"')) {
            return line.slice(1, -1).replaceAll('\\"', '"');
          } else {
            return line;
          }
        });

      const batchSize = 1000;
      for (
        let productIndex = 0;
        productIndex < allProductsEver.length;
        productIndex += batchSize
      ) {
        const batch = allProductsEver.slice(
          productIndex,
          productIndex + batchSize
        );

        await Promise.all(
          batch.map(async (productPath) => {
            const addedRemovedEventsStdout = await Bun.$`git log --oneline --diff-filter=AD ${branch} -- ${productPath}`.cwd('..').text()
            const addedRemovedEvents = addedRemovedEventsStdout
              .trim()
              .split("\n")
              .map((line) => line.split(" ")[1]);

            const firstAppearance = addedRemovedEvents.pop();
            const absenceRanges = addedRemovedEvents
              .reverse()
              .reduce<z.infer<typeof schema>["absenceRanges"]>(
                (ranges, event, index, array) => {
                  if (index % 2 === 1) {
                    ranges.push({ start: array[index - 1], end: event });
                  } else if (index === array.length - 1) {
                    ranges.push({
                      start: event,
                      end: undefined,
                    });
                  }
                  return ranges;
                },
                []
              );

            const id = productPath.replace(pathPrefix, "").replace(".yaml", "");
            if (id.length === 0) {
              return;
            }

            const product = {
              id,
              data: {
                firstAppearance,
                absenceRanges,
              },
            };

            try {
              store.set({ id, data: await parseData(product) });
            } catch (e) {
              console.error(`Error parsing ${productPath}:`, {
                product,
                addedRemovedEventsStdout,
                productPath,
              });
              throw e;
            }
          })
        );
      }
    },
  };
}

const products = defineCollection({
  loader: productLoader(),
});

export const collections = { products };
