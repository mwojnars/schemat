/*
Working with a RocksDB database.

CLI tool (ldb)
- install:   sudo apt install rocksdb-tools
- dump all keys:    ldb --db=/path/to/db scan
- dump range:       ldb --db=/path/to/db scan --from="key1" --to="key2"
- dump a key:       ldb --db=/path/to/db get "some-key"
- delete a key:     ldb --db=/path/to/db delete "some-key"
- put/update:       ldb --db=/path/to/db put "some-key" "new-value"
- other:            ldb ... approxsize [--from] [--to]
                    ldb ... checkconsistency
                    ldb ... deleterange <begin key> <end key>
Admin:
                    ldb ... dump / idump / load / backup / restore / repair / checkpoint
Example:
-                   ldb --db=./cluster/sample/node.1024/02_app.data.1029.rocksdb scan

Advanced analysis:
- SST files (compaction, bloom filters):    sst_dump --file=/path/to/sst --show_properties
- track compaction stats, cache hit/miss:   Prometheus/OpenTelemetry
*/

import {promisify} from 'node:util'
import rocksdb from 'rocksdb'

import {Store} from './store.js'


/**********************************************************************************************************************/

export class RocksDBStore extends Store {
    /* Local data store based on RocksDB. */

    _db = null
    _bound = null

    async open() {
        /* Open or create a RocksDB database at this.filename */
        this._db = rocksdb(this.filename)
        await promisify(this._db.open.bind(this._db))({create_if_missing: true})
        
        // bind and promisify all methods once
        this._bound = {
            get: promisify(this._db.get.bind(this._db)),
            put: promisify(this._db.put.bind(this._db)),
            del: promisify(this._db.del.bind(this._db))
        }
    }

    async get(key, opts) {
        /* Return JSON string stored under the binary key, or undefined if not found.
           Available options: asBuffer, fillCache.
         */
        try {
            const value = await this._bound.get(key, opts)
            return value.toString()
        } catch (err) {
            if (err.notFound) return undefined
            throw err
        }
    }

    async put(key, value, opts) {
        /* Store JSON string value under the binary key.
           If opts.sync=true, the write is flushed to disk before returning (slower but safer).
         */
        await this._bound.put(key, value, opts)
    }

    async del(key, checked = false) {
        if (!checked) return this._bound.del(key)
        try {
            await this._bound.get(key)   // raises error if not found
            await this._bound.del(key)
            return true
        } catch (err) {
            if (err.notFound) return false
            throw err
        }
    }

    async erase() {
        /* Remove all records from this store */
        // close and reopen the database to clear all data
        await promisify(this._db.close.bind(this._db))()
        await promisify(this._db.destroy.bind(this._db))(this.filename)
        await this.open()
    }

    async* scan(db, {limit, keys = true, values = true, ...opts} = {}) {
        /*
         Options accepted by RocksDB:
         - gt, gte, lt, lte:    start/end bound (exclusive / inclusive)
         - reverse:
         - keyAsBuffer/valueAsBuffer:   whether keys/values are returned as Buffers or strings (default: true)
         - snapshot:        whether to iterate over a consistent snapshot (default: true)
         - fillCache:       whether the read will populate the RocksDB block cache, which speeds up future reads to the same key or nearby keys;
                            default: true; fillCache=false is useful when doing large scans or bulk exports
         - highWaterMark:   maximum number of entries (key-value pairs) buffered in memory at a time during iteration; default: 16 or 64
         */
        if (!keys && !values) throw new Error(`at least one of the options 'keys', 'values', must be true`)
        let it = this._db.iterator({keyAsBuffer: true, valueAsBuffer: false, ...opts})
        try {
            while (true) {
                let [key, value] = await new Promise((resolve, reject) =>
                    it.next((err, k, v) => err ? reject(err) : resolve([k, v]))
                )
                if (key === undefined && value === undefined) break
                yield keys && values ? [key, value] : keys ? key : value
            }
        } finally {
            await new Promise(resolve => it.end(resolve))
        }
    }
}

/* DRAFT ...

// Unfortunately, the basic rocksdb Node.js bindings don't expose snapshot support directly,
// but if you're not doing high-frequency concurrent writes, a read-only stream is usually sufficient and safe,
// even if the database is being written to elsewhere, you can open a read-only instance for snapshotting:

import rocksdb from 'rocksdb'
import fs from 'fs'
import yaml from 'js-yaml' // for YAML output, if needed

const db = rocksdb('./my-rocksdb-path')

async function export_to_json_or_yaml({ output = 'backup.json', format = 'json' }) {
    return new Promise((resolve, reject) => {
        const result = {}

        db.open({ read_only: true }, (err) => {
            if (err) return reject(err)
            const stream = db.create_read_stream()

            stream
                .on('data', ({ key, value }) => {
                    result[key.toString()] = value.toString() // adjust encoding if needed
                })
                .on('error', reject)
                .on('end', () => {
                    const content = format === 'yaml' 
                        ? yaml.dump(result) 
                        : JSON.stringify(result, null, 2)

                    fs.writeFileSync(output, content, 'utf8')
                    resolve(`Backup saved to ${output}`)
                })
        })
    })
}

// if you want more control:

const yaml_content = yaml.dump(result, { indent: 2, line_width: 80 })
fs.writeFileSync('backup.yaml', yaml_content)

*/
