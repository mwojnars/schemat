import React, { useState } from 'react'

// test component with various jsx features
export default function TestComponent() {
    const [count, set_count] = useState(0)
    const [items, set_items] = useState(['item 1', 'item 2', 'item 3'])
    
    // test conditional rendering
    const show_message = count > 5
    
    // test event handling
    const handle_click = () => set_count(prev => prev + 1)
    
    // test list manipulation
    const add_item = () => set_items([...items, `item ${items.length + 1}`])
    
    return (
        <div className="test-container">
            {/* test basic props */}
            <h1 data-testid="title">Test JSX Component</h1>
            
            {/* test event handling and state */}
            <button onClick={handle_click}>
                Clicked {count} times
            </button>
            
            {/* test conditional rendering */}
            {show_message && (
                <p>Count is greater than 5!</p>
            )}
            
            {/* test list rendering */}
            <ul>
                {items.map((item, idx) => (
                    <li key={idx}>{item}</li>
                ))}
            </ul>
            
            {/* test more event handling */}
            <button onClick={add_item}>Add Item</button>
            
            {/* test inline styles */}
            <div style={{
                padding: '1rem',
                border: '1px solid #ccc',
                marginTop: '1rem'
            }}>
                Styled content
            </div>
        </div>
    )
}
