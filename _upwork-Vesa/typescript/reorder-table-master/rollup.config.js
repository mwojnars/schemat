import rollupTypescript from "@rollup/plugin-typescript";
import rollupSass from "rollup-plugin-sass";

export default {
  input: "./src/Catalog.tsx",
  output: { file: "rollup-dist/catalog.js", format: "es" },
  plugins: [rollupTypescript(), rollupSass()],
};
