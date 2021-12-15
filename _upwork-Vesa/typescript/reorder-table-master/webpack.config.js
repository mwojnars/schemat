const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");
const config = {
    devServer: {
        static: {
            directory: path.resolve(".", "dist"),
        },
        compress: true,
    },
    mode: process.env.NODE_ENV === "production" ? "production" : "development",
    devtool:
        process.env.NODE_ENV === "production" ? undefined : "eval-source-map",
    entry: "./src/index.tsx",
    output: {
        path: path.resolve("./", "dist"),
        filename: "bundle.js",
    },
    resolve: { extensions: [".js", ".ts", ".tsx"] },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                include: [path.resolve(".", "src")],
                use: "ts-loader",
            },
            {
                test: /\.(woff|woff2|eot|ttf|otf)$/i,
                type: "asset/resource",
            },
            {
                test: /\.svg$/i,
                type: "asset/resource",
            },
            {
                test: /\.s[ac]ss$/i,
                use: ["style-loader", "css-loader", "sass-loader"],
            },
        ],
    },
    plugins: [
        new HtmlWebpackPlugin({
            title: "Catalog component",
        }),
    ],
};

module.exports = config;
