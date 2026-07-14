import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		exclude: [
			"node_modules/**",
			"dist/**",
			".claude/**",
			"fake-angular-app/**",
			"fake-angular-app-base/**",
			"sample-app/**",
			"sample-app-base/**",
			"src/renderer/visual.test.ts",
		],
	},
});
