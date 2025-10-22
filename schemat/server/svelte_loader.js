import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { compile } from 'svelte/compiler'

export async function load(url, context, defaultLoad) {
    // console.log(`svelte_loader.load(${url})`)

    // handle only .svelte files, fallback to default loader for all other files
    if (!url.endsWith('.svelte')) return defaultLoad(url, context, defaultLoad)

    const filename = fileURLToPath(url)
    const source = await readFile(filename, 'utf8')

    // use Svelte compiler
    const out = compile(source, {
        filename,
        css: 'injected',        // or 'external'
        generate: 'server'      // or 'client'
    })
    if (out.warnings?.length) console.log(`Svelte compilation warnings:`, out.warnings)

    // console.log(`${url} compiled output:\n`, out.js.code)

    return {
        format: 'module',
        source: out.js.code,
        shortCircuit: true      // skip further loaders
    }
}
