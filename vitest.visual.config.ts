import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/renderer/visual.test.ts"],
		testTimeout: 30000,
	},
});
