import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  { ignores: [".next/**", "dist/**", "<isolated-worktrees>/**"] },
  ...nextVitals,
  ...nextTs
];

export default eslintConfig;
