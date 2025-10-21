import React from 'react'
import ReactDOM from 'react-dom/client'

// client-side hydration for jsx test pages
export default async function hydrate(request) {
    const Component = (await import(request.path.replace('::client', ''))).default
    ReactDOM.hydrateRoot(
        document.getElementById('root'),
        React.createElement(Component, request.params || {})
    )
}
