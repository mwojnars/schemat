/*
    Web adapters are functions that create handlers for HTTP requests.
    They can only be used on the server side. If executed in a browser, they will throw errors.
 */

// conditionally import the server-side modules
const fs  = SERVER && await import('fs')
const ejs = SERVER && await import('ejs')


/**********************************************************************************************************************/

export function html_page(path, locals = {}, opts = {}) {
    /* Returns a function that loads an HTML page: either from a static .html file, or from a template (.ejs).
       In the latter case, the template is rendered with `locals` as its variables, and special variables: `schemat`, `request` - are added by default.
     */
    return (request) => {
        if (path.startsWith('file://')) path = path.slice(7)
        const ext = path.includes('.') ? path.split('.').pop().toLowerCase() : 'html'
        // console.log('path:', path)
        
        // check the file type by extension and load/render the file accordingly
        if (ext === 'html' || ext === 'htm')
            return fs.readFileSync(path, 'utf-8')
        
        if (ext === 'ejs') {
            // async=true below allows EJS templates to include async code like `await import(...)` or `await fetch_data()`
            opts = {filename: path, views: schemat.PATH_WORKING, async: true, ...opts}
            const template = fs.readFileSync(path, 'utf-8')
            return ejs.render(template, {schemat, request, ...locals}, opts)
        }
        throw new Error(`Unsupported file type: ${ext}`)
    }
}

/* SVELTE component compilation:

    import { compile } from 'svelte/compiler'

    let source = fs.readFileSync('MyComponent.svelte', 'utf-8')
    let {js, css} = compile(source, {
      filename: 'MyComponent.svelte',
      generate: 'dom', // 'ssr' is also an option
      format: 'esm'
    })
    console.log(js.code) // The JS code that will run in the browser
 */
/* SVELTE injection of a component on client [index.html]:

    <html>
      <body>
        <div id="target"></div>

        <script type="module">
          import MyComponent from './MyComponent.svelte';
          const target = document.getElementById('target');
          const component = new MyComponent({
            target,
            props: { name: 'World' }
          });
        </script>
      </body>
    </html>

 */
