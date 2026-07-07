import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  test: {
    globals: false,
  },
});
