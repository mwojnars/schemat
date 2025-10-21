import React from 'react'

// layout component for jsx test pages
export default function TestLayout({children, title = 'React Test Component', scripts = []}) {
    return (
        <html>
            <head>
                <meta charset="utf-8" />
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
