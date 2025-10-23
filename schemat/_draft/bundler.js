import esbuild from 'esbuild'


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
