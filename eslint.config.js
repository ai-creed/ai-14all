import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: [
			"out/**",
			"dist/**",
			"test-results/**",
			"node_modules/**",
			".worktrees/**",
			"docs/**",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["**/*.{ts,tsx,js,mjs,cjs}"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		plugins: {
			"@stylistic": stylistic,
			"react-hooks": reactHooks,
		},
		rules: {
			"no-var": "error",
			"no-eval": "error",
			"no-trailing-spaces": "error",
			"no-multiple-empty-lines": ["error", { max: 1, maxEOF: 1 }],
			"@stylistic/quotes": ["error", "double", { avoidEscape: true }],
			"@stylistic/semi": ["error", "always"],
			"@stylistic/comma-dangle": ["error", "always-multiline"],
			"react-hooks/exhaustive-deps": "warn",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
				},
			],
		},
	},
	{
		files: ["shared/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: [
								"**/src/**",
								"../**/src/*",
								"../../src/**",
								"../../../src/**",
							],
							message:
								"shared/ must not import from src/. Move the contract into shared/ or keep the type in src/.",
						},
					],
				},
			],
		},
	},
	{
		files: ["services/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["**/src/**", "../**/src/*"],
							message: "services/ must not import from src/.",
						},
					],
				},
			],
		},
	},
	{
		files: ["electron/**/*.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["**/src/**", "../**/src/*"],
							message: "electron/ must not import from src/.",
						},
					],
				},
			],
		},
	},
);
