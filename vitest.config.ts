import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 200000,
    hookTimeout: 200000,
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
    include: ["src/**/*.test.ts"],
    pool: "forks",
    deps: {
      interopDefault: true,
    },
    server: {
      deps: {
        inline: [/@aztec\/.*/],
      },
    },
  },
});
