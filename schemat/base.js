// import mysql from 'mysql2'
import {assert, print} from './utils.js'
import {DB} from './server/db.js'

//let db = mysql.createConnection(srv)
//db.connect()
//db.query('SELECT id, pid, title FROM pap_papers_view WHERE id>=9035 AND id < 9050', (e,r,f) => console.log(r))

// let srv = {host: '127.0.0.1', port: '3307', user: 'paperity', database: 'paperity', password: 'pe45n1bc'}
// let db = await mysql.createConnection(srv)
// let [rows, fields] = await db.execute('SELECT id, pid, title FROM pap_papers_view WHERE id>=9035 AND id < 9050')


export class MySQL extends DB {

    async open() {
        await super.open()
        this._mod_mysql = await import('mysql2/promise')
        this._sqlTables = await this._initTables()          // mapping of CID numbers to SQL table names
        this.db = await this._connect()
    }
    async close() { return this.db?.end() }                 // deallocate mysql connection
    async end()   { return this.close()   }

    async _connect() {
        let opts = {dateStrings: true}              // also of use if dateStrings=false: timezone='Z' means UTC, 'local' means take server's timezone
        let conn = this.prop('connection') || {}
        let args = this.propObject('host', 'port', 'user', 'database', 'password')
        return this._mod_mysql.createConnection({...opts, ...conn, ...args})      // individual parameters, if defined, override the 'connection' object
    }

    async _read([cid, iid], opts) {
        let select = this._select(cid)
        if (!select) return
        let query = `${select} WHERE id = ? LIMIT 1`
        let category = await this.registry.getCategory(cid)
        let [rows, cols] = await this.db.execute(query, [iid])
        if (rows.length) return this._convert(rows[0], category)
    }

    async *_scan(cid, {offset = 0, limit = 100} = {}) {
        let query = this._select(cid)
        if (!query) return
        if (limit) {
            query += ` LIMIT ${limit}`
            if (offset) query += ` OFFSET ${offset}`        // offset is only allowed together with limit in MySQL
        }
        let category = await this.registry.getCategory(cid)
        let [rows, cols] = await this.db.execute(query)
        for (let row of rows)
            yield {id: [cid, row.id], data: this._convert(row, category)}
    }

    _table(cid) {
        /* Map CID to the name of a sql table */
        return this._sqlTables.get(cid)
    }
    async _initTables() {
        /* Compute the mapping of CID numbers to SQL table names and return as a Map object. */
        let tables = this.prop('tables')
        let sqlTables = new Map()
        for (let {key: path, value: sqlTable} of tables.entries()) {
            assert(path)
            let cid = Number(path)
            if (!Number.isInteger(cid)) {
                let catg = await this.registry.findItem(path)
                assert(catg.isCategory)
                cid = catg.iid
            }
            assert(cid)
            sqlTables.set(cid, sqlTable)
        }
        // print('MySQL._sqlTables:', sqlTables)
        return sqlTables
    }

    _select(cid) {
        /* Build the SELECT... FROM... part of a query for a given CID. Return undefined if this particular CID is unsupported. */
        // let tables = this.get('tables')
        // let table  = tables.get(`${cid}`)               // map CID to the name of a sql table
        let table = this._sqlTables.get(cid)
        if (!table) return
        table = table.trim()
        let spaces = /\s/g.test(table)                  // `table` is either a table name or a "SELECT ... FROM ..." statement that contains spaces
        return spaces ? table : `SELECT * FROM ${table}`
    }
    _convert(row, category) {
        /* Clean and convert a `row` of data to JSON string compatible with the category's schema. */
        let schema = category.getItemSchema()
        let keys   = Object.keys(row)
        for (let key of keys) if (!schema.has(key)) delete row[key]     // drop DB fields with no corresponding category field
        return JSON.stringify(row)                                      // flat object (encoded) from DB is converted to a JSON string
    }

    _drop(key, opts) { return false }

}

// export {MySQL as default}
