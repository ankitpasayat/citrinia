import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import stylex from "@stylexjs/eslint-plugin";

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@stylexjs": stylex },
    rules: {
      "@stylexjs/valid-styles": "error",
      "@stylexjs/no-legacy-contextual-styles": "error",
    },
  },
];

export default config;
