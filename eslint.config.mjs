import { defineConfig } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import unusedImports from "eslint-plugin-unused-imports";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "public/**",
      "*.min.js",
    ],
  },

  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "unused-imports": unusedImports,
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "@next/next/no-img-element": "off",
      "react/no-unescaped-entities": "off",

      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-unused-vars": "off",

      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],

      "simple-import-sort/imports": "warn",
      "simple-import-sort/exports": "warn",

      "no-unreachable": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-console": ["warn", { allow: ["warn", "error"] }],

      eqeqeq: ["warn", "always"],
      curly: ["warn", "all"],
    },
  },

  {
    files: ["app/api/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  {
    files: [
      "app/admin/**/*.tsx",
      "app/member/**/*.tsx",
      "components/**/*.tsx",
      "lib/**/*.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
]);
