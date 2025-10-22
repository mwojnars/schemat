import React from 'react'

// HTML framing for jsx pages
export default function Skeleton({children, title = 'Page', scripts = []}) {
    return (
        <html>
            <head>
                <meta charSet="utf-8" />
                <title>{title}</title>
            </head>
            <body>
                <div dangerouslySetInnerHTML={{ __html: schemat.init_client() }} />
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
