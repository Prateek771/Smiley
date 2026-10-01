import { expect, test as base } from "@playwright/test";

let clientSequence = 0;

export const test = base.extend({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provideHeaders, testInfo) => {
    clientSequence += 1;
    if (testInfo.workerIndex >= 512 || clientSequence > 255) {
      throw new Error("Synthetic HTTP client address capacity exceeded.");
    }
    // Each test is one client in the 198.18.0.0/15 benchmark range. A single
    // forwarded address preserves production auth limits without shared buckets.
    const clientIp = `198.${18 + Math.floor(testInfo.workerIndex / 256)}.${testInfo.workerIndex % 256}.${clientSequence}`;
    await provideHeaders({ ...extraHTTPHeaders, "x-forwarded-for": clientIp });
  },
});

export { expect };
