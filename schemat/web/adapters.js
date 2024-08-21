/*
    Web adapters are functions that create handlers for HTTP requests.
    They can only be used on the server side. If executed in a browser, they will throw errors.
 */

// conditionally import the server-side modules
const fs  = SERVER && await import('fs')
const ejs = SERVER && await import('ejs')


/**********************************************************************************************************************/

export function html_page(filename, locals = {}, opts = {}) {
    /* Returns a function that loads an HTML page: either from a static .html file or from a template (.ejs);
        in the latter case, the template is rendered with `locals` as its variables.
     */
    return () => {
        if (filename.startsWith('file://')) filename = filename.slice(7)
        const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : 'html'
        
        // check the file type by extension and load/render the file accordingly
        if (ext === 'html' || ext === 'htm')
            return fs.readFileSync(filename, 'utf-8')
        
        if (ext === 'ejs') {
            const template = fs.readFileSync(filename, 'utf-8')
            return ejs.render(template, locals, opts)
        }
        throw new Error(`Unsupported file type: ${ext}`)
    }
}
