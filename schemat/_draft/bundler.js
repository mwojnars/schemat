/**
 * PROMPT:
 * In Node.js, how to programmatically build ESM dependency graph of a specific .js file, in the way a bundler does (like Vite)? Write the code. Use ESBuild.
 * The files should be listed at the end, and a bundled JS code string produced (no save). If needed, add a plugin to let ESBuild handle *.svelte files.
 * Write the code with 4-space indentation. Drop trailing commas and braces where possible.
 */

import esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'
import svelte from 'svelte/compiler'

// Svelte plugin for ESBuild
const sveltePlugin = {
    name: 'svelte',
    setup(build) {
        build.onLoad({ filter: /\.svelte$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8')
            const { js } = svelte.compile(source, { filename: args.path })
            return {
                contents: js.code,
                loader: 'js'
            }
        })
    }
}

async function buildDependencyGraph(entryFile) {
    const files = new Set()

    const result = await esbuild.build({
        entryPoints: [entryFile],
        bundle: true,
        write: false,
        format: 'esm',
        plugins: [sveltePlugin],
        logLevel: 'silent',
        metafile: true,
        // platform: 'neutral',  // neutral or node     -- might be needed for ESM output ??
    })

    // Collect all files from metafile
    if (result.metafile)
        for (const file of Object.keys(result.metafile.inputs))
            files.add(path.resolve(file))

    return {
        files: Array.from(files),
        bundledCode: result.outputFiles[0].text
    }
}

// Example usage
;(async () => {
    const entry = './src/main.js'
    const { files, bundledCode } = await buildDependencyGraph(entry)
    console.log('Dependency files:', files)
    console.log('Bundled code length:', bundledCode.length)
})()

/*********************/

function convertCjsToEsm_simple(filePath) {
    /* Simple CJS > ESM conversion. No support for dynamic require, __dirname, __filename, or when the file mutates exports dynamically. */
    let code = fs.readFileSync(filePath, 'utf8')

    // Simple transformations (for small modules)
    code = code.replace(/module\.exports\s*=\s*/, 'export default ')
    code = code.replace(/exports\.(\w+)\s*=\s*/, 'export const $1 = ')

    // Wrap require calls as dynamic imports if needed
    code = code.replace(/require\(['"](.+?)['"]\)/g, 'await import("$1")')

    return code
}

async function convertCjsToEsm_esbuild(filePath) {
    /* ESBuild-based conversion of CJS to ESM, with possibly better handling of edge cases. */
    const code = await fs.promises.readFile(filePath, 'utf8')
    const result = await esbuild.transform(code, {
        loader: 'js',    // ESBuild can infer CJS from require/module.exports
        format: 'esm',
        target: ['esnext']
    })
    return result.code
}
