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

    async open() {
        /* Open or create a RocksDB database at this.filename */
        this._db = rocksdb(this.filename)
        await promisify(this._db.open.bind(this._db))({create_if_missing: true})
    }

    async get(key) {
        /* Return JSON string stored under the binary key, or undefined if not found */
        try {
            const value = await promisify(this._db.get.bind(this._db))(key)
            return value.toString()
        } catch (err) {
            if (err.notFound) return undefined
            throw err
        }
    }

    async put(key, value) {
        /* Store JSON string value under the binary key */
        await promisify(this._db.put.bind(this._db))(key, value)
    }

    async del(key, checked = false) {
        if (!checked) return promisify(this._db.del.bind(this._db))(key)
        try {
            await promisify(this._db.get.bind(this._db))(key)   // raises error if not found
            await promisify(this._db.del.bind(this._db))(key)
            return true
        } catch (err) {
            if (err.notFound) return false
            throw err
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
