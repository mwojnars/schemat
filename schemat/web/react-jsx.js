/*
    npm install @babel/core @babel/preset-react @babel/plugin-syntax-jsx
 */

import {readFileSync} from 'fs'
import {join} from 'path'
import {transformAsync} from '@babel/core'

export async function transpileJSX(path, {short = true} = {}) {
    /* Function to transpile JSX to JS. */
    try {
        let jsx = readFileSync(path, 'utf8')            // read the file contents
        let {code} = await transformAsync(jsx, {        // use Babel to transpile JSX to JavaScript
            presets: ['@babel/preset-react'],           // preset for transpiling JSX
        })

        // optionally define a shortcut for React.createElement() and use it instead of the full name
        let alias = 'EL'
        let exist = new RegExp(`\\b${alias}\\b`)
        if (short) {
            if (exist.test(code)) {
                console.warn(`transpileJSX(${path}): the alias name (${alias}) is already used in the code, cannot replace React.createElement`)
                return code
            }

            code = code.replace(/React\.createElement/g, alias)
            // code = `let ${alias} = React.createElement;\n${code}`

            // regex to match the header block: empty lines, comments, import statements
            let header = /^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s*import[^\n]*))*\n?/

            // insert the alias after the header block, so that all imports execute beforehand
            code = code.replace(header, match => match + `\nlet ${alias} = React.createElement;\n`)
        }
        return code

    } catch (error) {
        console.error('Error transpiling JSX:', error)
        throw error
    }
}

function example() {
    // example usage:
    let file = join(process.cwd(), 'example.jsx')
    transpileJSX(file).then(js => {console.log('Transpiled JS code:', js)})
}
