import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { resolve as pathResolve } from 'node:path'


export async function resolve(specifier, context, nextResolve) {
    // console.log(`alias_resolver.resolve():`, context.parentURL, '-->', specifier)

    // let parentUrl = new URL(context.parentURL || import.meta.url)
    // let parentPath = parentUrl.pathname
    // if (!parentPath.includes('/node_modules/')) {/* only rewrite imports originating in the application itself */}

    // Example: map $alias/... to ./src/alias/...
    if (specifier.startsWith('$')) {
        // Compute the file system path
        let baseDir = pathResolve(fileURLToPath(import.meta.url), '../src')
        let targetPath = pathResolve(baseDir, specifier.slice(1))
        return {
            url: pathToFileURL(targetPath).href
        }
    }

    // fall back to Node’s default resolution
    return nextResolve(specifier, context)
}
