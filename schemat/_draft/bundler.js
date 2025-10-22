/**
 * PROMPT:
 * In Node.js, how to programmatically build ESM dependency graph of a specific .js file, in the way a bundler does (like Vite)? Write the code. Use ESBuild.
 * The files should be listed at the end, and a bundled JS code string produced (no save). If needed, add a plugin to let ESBuild handle *.svelte files.
 */

import esbuild from 'esbuild'
import fs from 'fs'
import path from 'path'
import * as svelte from 'svelte/compiler'

// svelte plugin for esbuild
const svelte_plugin = {
    name: 'svelte',
    setup(build) {
        build.onLoad({ filter: /\.svelte$/ }, async (args) => {
            const source = await fs.promises.readFile(args.path, 'utf8')
            const { js } = svelte.compile(source, {
                filename: args.path,
                css: 'injected',
                generate: 'client'
            })
            return {
                contents: js.code,
                loader: 'js'
            }
        })
    }
}

export async function find_dependencies(entry_file) {
    const files = new Set()
    const cwd = path.isAbsolute(entry_file) ? path.dirname(entry_file) : process.cwd()

    let result = await esbuild.build({
        entryPoints: [entry_file],
        // absWorkingDir: cwd,
        // outfile: 'out.js',
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        // target: ['es2020'],
        // mainFields: ['browser', 'module', 'main'],
        // conditions: ['browser', 'import'],
        // resolveExtensions: ['.svelte', '.js', '.jsx', '.ts', '.tsx', '.mjs'],
        plugins: [svelte_plugin],
        logLevel: 'silent',
        metafile: true
    })

    // collect all files from metafile
    if (result.metafile)
        for (const file of Object.keys(result.metafile.inputs))
            files.add(path.resolve(cwd, file))

    // // collect import statements
    // for (const [filePath, info] of Object.entries(result.metafile.inputs)) {
    //     console.log('Resolved file:', filePath)
    //     if (info.imports.length)
    //         for (const imp of info.imports) {
    //             console.log('  Imported as:', imp.path)
    //         }
    //     // TODO: unwrap `result.metafile.inputs` and `result.metafile.outputs` for import path -> file path mapping
    // }

    return {
        files: Array.from(files),
        bundle: result.outputFiles?.[0]?.text || ''
    }
}

// example usage (run only when executed directly)
// if (process.argv[1] && new URL(import.meta.url).pathname === path.resolve(process.argv[1])) {
//     ;(async () => {
//         const entry = process.argv[2]
//         if (!entry) return
//         const { files, bundle } = await find_dependencies(entry)
//         console.log('dependency files:', files)
//         console.log('bundled code length:', bundle.length)
//     })()
// }

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
