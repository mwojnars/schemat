/* Server-side utilities that depend on Node.js API. */

import { stat } from 'node:fs/promises'


export async function check_file_type(path) {
    try {
        let stats = await stat(path)

        if (stats.isFile()) return 'file'
        if (stats.isDirectory()) return 'directory'
        if (stats.isSymbolicLink()) return 'symlink'
        if (stats.isSocket()) return 'socket'
        if (stats.isFIFO()) return 'fifo'
        if (stats.isBlockDevice()) return 'block-device'
        if (stats.isCharacterDevice()) return 'char-device'

        return 'unknown'
    } catch (err) {
        if (err.code === 'ENOENT') return 'none'
        throw err
    }
}
