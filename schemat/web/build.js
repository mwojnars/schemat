/*
    Utilities for server-side build process: dependency tracking and compilation.
 */

import fs from 'node:fs'
import path from 'node:path'
import esbuild from 'esbuild'
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


export async function bundle_dependencies(entry_files = [], {minify = false} = {}) {
    /* Find all dependencies of entry_files and bundle them into a single file.
       Return an object with two properties:
       - files: an array of all files that were bundled
       - bundle: the bundled code
     */
    const files = new Set()
    // const cwd = process.cwd()

    let result = await esbuild.build({
        entryPoints: entry_files,
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        plugins: [svelte_plugin],
        logLevel: 'silent',
        metafile: true,
        minify: minify,

        // mainFields: ['browser', 'module', 'main'],   // controls which fields in a package’s package.json are checked — and in what order — to determine which entry file to use when resolving a bare import
        // conditions: ['browser', 'import'],           // controls conditional exports resolution when a package uses the "exports" field in its package.json
        // resolveExtensions: ['.svelte', '.js', '.jsx', '.ts', '.tsx', '.mjs'],
        // target: ['es2020'],
        // absWorkingDir: cwd,
        // outfile: 'out.js',
    })

    // collect all files from metafile
    if (result.metafile)
        for (const file of Object.keys(result.metafile.inputs))
            files.add(file)
            // files.add(path.resolve(cwd, file))

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
