// import mysql from 'mysql2'
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
        this.db = await this._connect()
    }
    async close() { return this.db?.end() }             // deallocate mysql connection
    async end()   { return this.close()   }

    async _connect() {
        let conn  = this.get('connection') || {}
        let args  = this.getSubset('host', 'port', 'user', 'database', 'password')
        return this._mod_mysql.createConnection({...conn, ...args})      // individual parameters, if defined, override the 'connection' object
    }

    async _read([cid, iid], opts) {
        let select = this._select(cid)
        if (!select) return
        let query  = `${select} WHERE id = ? LIMIT 1`
        let [rows, cols] = await this.db.execute(query, [iid])
        if (rows.length) return JSON.stringify(rows[0])     // flat object (encoded) from DB is returned as a JSON string
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
        for (let row of rows) yield this._convert(row, category)
            // let id = [cid, row.id]
            // delete row.id
            // yield {id, data: JSON.stringify(row)}
    }

    _select(cid) {
        /* Build the SELECT... FROM... part of a query for a given CID. Return undefined if this particular CID is unsupported. */
        let tables = this.get('tables')
        let table  = tables.get(`${cid}`)               // map CID to the name of a sql table
        if (!table) return
        table = table.trim()
        let spaces = /\s/g.test(table)                  // `table` is either a table name or a "SELECT ... FROM ..." statement that contains spaces
        return spaces ? table : `SELECT * FROM ${table}`
    }
    _convert(row, category) {
        /* Convert a `row` of data to an encoded flat object of a given category, compatible with the category's schema. */
        let id = [category.iid, row.id]
        delete row.id
        let fields = category.getFields()
        let keys   = Object.keys(row)
        for (let key of keys) if (!fields.has(key)) delete row[key]     // drop DB fields with no corresponding category field
        return {id, data: JSON.stringify(row)}
    }

    _drop(key, opts) { return false }

}