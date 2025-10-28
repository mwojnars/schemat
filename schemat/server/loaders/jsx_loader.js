import { transformSync } from '@babel/core'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
    return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
    if (!url.endsWith('.jsx')) {
        return nextLoad(url, context)
    }

    // read the JSX file
    const source = await readFile(new URL(url), 'utf8')
    const filename = fileURLToPath(url)          // ensure a proper filesystem path string for babel

    // transform JSX to JS
    const result = transformSync(source, {
        presets: [
            ['@babel/preset-react', {
                runtime: 'automatic',
                importSource: 'react'
            }]
        ],
        filename,
        sourceMaps: true,
        sourceFileName: filename
    })

    return {
        format: 'module',
        source: result.code,
        shortCircuit: true
    }
}
