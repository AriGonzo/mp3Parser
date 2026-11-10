import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default defineConfig(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Allow deliberately unused arguments when prefixed with _, e.g. Express's
      // error handler must declare (err, req, res, next) even if `next` isn't used.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  // Turns off any lint rules that would fight with Prettier's formatting.
  prettier,
);
