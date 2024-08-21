/*
    Web adapters are functions that create handlers for HTTP requests.
    They can only be used on the server side. If executed on the client, they will throw errors.
 */


import { tryimport } from '../common/utils'

// conditionally import the modules
let fs = await tryimport('node:fs')
let ejs = await tryimport('ejs')


/**********************************************************************************************************************/

export function html_page(filename, locals = {}, opts = {}) {
    /* Returns a function that loads an HTML page: either from a static .html file or from a template (.ejs);
        in the latter case, the template is rendered with `locals` as its variables.
     */
    return () => {
        // check the file type by extension... load/render the file accordingly...
        const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : 'html'
        
        if (ext === 'html' || ext === 'htm')
            return fs.readFileSync(filename, 'utf-8')
        
        else if (ext === 'ejs') {
            const template = fs.readFileSync(filename, 'utf-8')
            return ejs.render(template, locals, opts)
        } 
        throw new Error(`Unsupported file type: ${ext}`)
    }
}
