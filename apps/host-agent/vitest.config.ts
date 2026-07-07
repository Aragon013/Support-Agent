import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // allow vitest to resolve .ts files when the import uses .js extension (NodeNext convention)
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    globals: false,
  },
});
