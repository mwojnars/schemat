const esbuild = require("esbuild");
const { sassPlugin } = require("esbuild-sass-plugin");
const GlobalsPlugin = require("esbuild-plugin-globals");

esbuild.build({
  bundle: true,
  entryPoints: ["./src/index.tsx"],
  format: "iife",
  outfile: "esbuild-dist/bundle.js",
  plugins: [sassPlugin(), GlobalsPlugin({
      react: "React",
      "react-dom": "ReactDOM",
  })],
});
