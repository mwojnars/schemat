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

    Help with memory leaks:
    - https://github.com/facebook/rocksdb/wiki/Memory-usage-in-RocksDB
    - https://medium.com/expedia-group-tech/solving-a-native-memory-leak-71fe4b6f9463
    - https://lists.apache.org/thread/b02vjqtoonmt6v7dg26dqgpn7fdqj1k9
*/

import {promisify} from 'node:util'
import {rm} from 'fs/promises'
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
            del: promisify(this._db.del.bind(this._db)),
            batch: promisify(this._db.batch.bind(this._db))
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
        // TODO: drop `checked` arg
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
        await promisify(this._db.close.bind(this._db))()
        await rm(this.filename, {recursive: true, force: true})
        await this.open()
    }

    async close() {
        /* Close the database, ensuring all resources are properly released.
           After calling this method, no other methods should be called on this instance.
         */
        if (this._db) {
            await promisify(this._db.close.bind(this._db))()
            this._db = null
            this._bound = null
        }
    }

    async* scan({start, stop, limit, keys = true, values = true, ...opts} = {}) {
        /*
         Options:
         - start:           start bound (inclusive), same as `gte` below
         - stop:            end bound (exclusive), same as `lt` below
         - limit:           maximum number of entries to return
         - keys, values:    whether to return keys or values only
         - reverse:         whether to scan in reverse order

         Options specific to RocksDB:
         - gt, gte, lt, lte:    start/end bound (exclusive / inclusive)
         - keyAsBuffer/valueAsBuffer:   whether keys/values are returned as Buffers or strings (default: true)
         - snapshot:        whether to iterate over a consistent snapshot (default: true)
         - fillCache:       whether the read will populate the RocksDB block cache, which speeds up future reads to the same key or nearby keys;
                            default: true; fillCache=false is useful when doing large scans or bulk exports
         - highWaterMark:   maximum number of entries (key-value pairs) buffered in memory at a time during iteration; default: 16 or 64
         */

        if (!keys && !values) throw new Error(`at least one of the options 'keys', 'values', must be true`)
        opts.gte ??= start
        opts.lt  ??= stop

        let it = this._db.iterator({keyAsBuffer: true, valueAsBuffer: false, ...opts})
        let count = 0
        
        try {
            while (true) {
                if (limit !== undefined && count >= limit) break
                let [key, value] = await new Promise((resolve, reject) =>
                    it.next((err, k, v) => err ? reject(err) : resolve([k, v]))
                )
                if (key === undefined && value === undefined) break
                
                count++
                yield keys && values ? [key, value] : keys ? key : value
            }
        } finally {
            await new Promise((resolve, reject) => it.end(err => err ? reject(err) : resolve()))
        }
    }

    async bulk(operations, opts = {}) {
        /* Execute multiple write operations atomically in a single batch.
           @param operations: Array of objects with format:
             {type: 'put'|'del', key: binary-key, value?: string}
           @param opts: Options object that can include:
             - sync: if true, the save is flushed to disk before returning
         */
        await this._bound.batch(operations, opts)
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
