import React from 'react'

// layout component for jsx pages
export default function Layout({children, title = 'Page', scripts = []}) {
    return (
        <html>
            <head>
                <meta charSet="utf-8" />
                <title>{title}</title>
            </head>
            <body>
                <div id="root">
                    {children}
                </div>
                {scripts.map((src, idx) => (
                    <script key={idx} type="module" src={src} />
                ))}
            </body>
        </html>
    )
}

/*
// client-side hydration for jsx pages ...

import React from 'react'
import ReactDOM from 'react-dom/client'

export default async function hydrate(request) {
    const Component = (await import(request.path.replace('::client', ''))).default
    ReactDOM.hydrateRoot(
        document.getElementById('root'),
        React.createElement(Component, request.params || {})
    )
}
 */
