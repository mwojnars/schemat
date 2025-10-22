/*
    DRAFT ... Simplistic SvelteKit-like routing.
    - Filesystem-based routing (routes/...)
    - +page.svelte and +layout.svelte with $props() and {@render children()}
    - Simple data loading via +page.js / load()
    - Basic nesting of layouts (1-level)

    Missing SvelteKit functionality:
    - No parameter parsing or route precedence.
    - No CSR.
    Other:
    - `sirv` web server, as used by SvelteKit for serving static files
      - maps file extensions to MIME types
      - caching support: ETag and Last-Modified headers
      - compression (gzip/Brotli)
      - security: prevents directory traversal


    INFO. SvelteKit 5 routing, overall procedure:

        Request →
          hooks.server.js (handle)
          [route matching]                          -- uses precomputed "manifest" list of all routes
          +server.js                                -- API "endpoint" route, only runs GET/POST() func; +page / +layout ("page route") files not used!
          +layout.server.js & +layout.js (data)     -- load() functions executed across all folder levels, from top to bottom
          +page.server.js & +page.js (data)         -- load() function(s) executed in bottom-most foler .. all `data` objects from load() calls merged
          +layout.svelte (render)                   -- all nested layouts rendered with `let {data,children}=$props()`: rootLayout.render({children: () => blogLayout.render({children: () => page.render()})
          +page.svelte (render)                     -- rendered as the deepest view during layout chain rendering
          +error.svelte & layout.error.svelte       -- if error occurred above, the nearest +error.svelte in the layout chain is rendered instead
          hooks.server.js (handleFetch/Error)
        Response                                    -- merged `data` is sent as inline JSON block in the HTML for hydration

        Client:
        1. The browser loads the SvelteKit client runtime.
        2. It hydrates the SSR’d markup into interactive components.
        3. Client-side navigation begins:
           - Only runs +layout.js and +page.js (not the server versions)
           - Reuses persisted layouts
           - Updates {@render children()} accordingly

        Async code (await) can be used in all .js files; in .svelte files, it's allowed inside functions, but NOT at top-level in <script>.

 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { compile } from 'svelte/compiler'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const routesDir = path.join(__dirname, 'routes')
const app = express()

// Recursively discover +page.svelte files
function discoverRoutes(dir = routesDir, base = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const routes = []

    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory())
            routes.push(...discoverRoutes(full, base + '/' + entry.name))
        else if (entry.name === '+page.svelte')
            routes.push({ path: base || '/', dir })
    }
    return routes
}

// Compile Svelte file to SSR component
function compileSvelte(filePath) {
    const src = fs.readFileSync(filePath, 'utf8')
    const { js } = compile(src, { generate: 'ssr', hydratable: true })
    const module = {}
    const render = eval(`(function(module){${js.code}; return module.exports})({})`)
    return render
}

// Find the nearest layout.svelte for a directory
function findLayout(dir) {
    let current = dir
    while (current.startsWith(routesDir)) {
        const layoutPath = path.join(current, '+layout.svelte')
        if (fs.existsSync(layoutPath)) return layoutPath
        current = path.dirname(current)
    }
    return null
}

// Discover all routes
const routes = discoverRoutes()

// Attach routes to Express
for (const route of routes) {
    const pagePath = path.join(route.dir, '+page.svelte')
    const pageJsPath = path.join(route.dir, '+page.js')
    const serverJsPath = path.join(route.dir, '+server.js')

    // Optional HTTP endpoint handler
    if (fs.existsSync(serverJsPath)) {
        const handlers = await import(serverJsPath)
        for (const method of ['get', 'post', 'put', 'delete'])
            if (handlers[method.toUpperCase()])
                app[method](route.path, handlers[method.toUpperCase()])
    }

    // Page rendering route
    app.get(route.path, async (req, res) => {
        // Load page data
        let pageData = {}
        if (fs.existsSync(pageJsPath)) {
            const mod = await import(pageJsPath)
            if (mod.load) pageData = await mod.load({ params: req.params })
        }

        // Compile page component
        const Page = compileSvelte(pagePath)

        // Build layout chain
        const layoutPath = findLayout(route.dir)
        let html = null

        if (layoutPath) {
            const Layout = compileSvelte(layoutPath)
            // Render layout with children as a function
            html = Layout.render({
                children: () => Page.render({ data: pageData }).html,
                data: pageData
            }).html
        } else
            html = Page.render({ data: pageData }).html

        res.send(html)
    })
}

app.listen(3000, () => console.log('Server running on http://localhost:3000'))
