/*
    npm install @babel/core @babel/preset-react @babel/plugin-syntax-jsx
 */

import {readFileSync} from 'fs'
import {join} from 'path'
import {transformAsync} from '@babel/core'

// Function to transpile JSX to JS
export async function transpileJSX(filePath){
    try {
        let jsx = readFileSync(filePath, 'utf8')        // read the file contents
        let {code} = await transformAsync(jsx, {        // use Babel to transpile JSX to JavaScript
            presets: ['@babel/preset-react'],           // preset for transpiling JSX
        })
        return code

    } catch (error) {
        console.error('Error transpiling JSX:', error)
        throw error
    }
}

// Example usage:
let file = join(process.cwd(), 'example.jsx')
transpileJSX(file).then(js => {console.log('Transpiled JS code:', js)})

