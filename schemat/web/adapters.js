/*
    Web adapters are functions that create handlers for HTTP requests.
 */


export function html_page(filename, locals = {}, opts = {}) {
    /* Return a function that generates an HTML page: either from a static .html file, or from a template (.ejs);
       in the latter case, the template is rendered with `locals` as its variables.
     */
    return function html_generate(request) {
        // `request` is the Schemat's custom Request object
    }
}