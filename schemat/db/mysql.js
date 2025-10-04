// import mysql from 'mysql2'
import {assert, print, T} from '../common/utils.js'
import { DataBlock } from './block.js'

//let db = mysql.createConnection(srv)
//db.connect()
//db.query('SELECT id, pid, title FROM pap_papers_view WHERE id>=9035 AND id < 9050', (e,r,f) => console.log(r))

// let srv = {host: '127.0.0.1', port: '3307', user: '........', database: '.........', password: '......'}
// let db = await mysql.createConnection(srv)
// let [rows, fields] = await db.execute('SELECT id, pid, title FROM pap_papers_view WHERE id>=9035 AND id < 9050')


export class MySQL extends DataBlock {

    // properties
    offset
    connection
    tables

    // temporary
    _sqlTables              // array of SQL table names
    _categories             // array of Category items corresponding to SQL tables; TODO: enable reload of category items

    get _offset() { return this.offset || 0 }
    get _size()   { return this._sqlTables.length }

    async open() {
        await super.open()
        this._mod_mysql = await import('mysql2/promise')
        await this._initTables()
        this.db = await this._connect()
    }
    async close() { return this.db?.end() }                 // deallocate mysql connection
    async end()   { return this.close()   }

    async _connect() {
        let opts = {dateStrings: true}              // also of use if dateStrings=false: timezone='Z' means UTC, 'local' means take server's timezone
        let conn = this.connection || {}
        let args = T.subset(this, 'host', 'port', 'user', 'database', 'password')
        return this._mod_mysql.createConnection({...opts, ...conn, ...args})      // individual parameters, if defined, override the 'connection' object
    }

    iidToSQL(iid) {
        /* Mapping Schemat ID to a SQL table name and row ID. */
        if (iid < this._offset) return []
        let row_id = Math.floor((iid - this._offset) / this._size)
        let table_id = (iid - this._offset) % this._size
        return [table_id, row_id]
    }
    iidFromSQL(table_id, row_id) {
        /* Mapping SQL table and row ID to Schemat ID. */
        return this._offset + row_id * this._size + table_id
    }

    async _initTables() {
        /* Compute the mapping of CID numbers to SQL table names and return as a Map object. */
        let tables = this.tables
        this._sqlTables = []
        this._categories = []

        for (let [path, sqlTable] of tables) {
            assert(path)
            let category = await schemat.import(path)
            assert(category.is_loaded())
            assert(category.is_category())

            this._sqlTables.push(sqlTable)
            this._categories.push(category)
        }
        // print('MySQL._sqlTables:', this._sqlTables)
        // print('MySQL._categories:', this._categories.map(c => c.prop('name')))
    }

    _convert(row, category) {
        /* Clean and convert a `row` of data to JSON string compatible with the category's schema. */
        let schema = category.child_schema
        let keys   = Object.keys(row)
        for (let key of keys) if (!schema.isValidKey(key)) delete row[key]     // drop DB fields with no corresponding category field
        row['__category'] = {'@': category.id}
        return JSON.stringify(row)                                      // flat object (encoded) from DB is converted to a JSON string
    }

    _query_select(table_id) {
        /* Build the SELECT... FROM... part of a query for a given CID. Return undefined if this particular CID is unsupported. */
        let table = this._sqlTables[table_id]
        table = table.trim()
        let spaces = /\s/g.test(table)                  // `table` is either a table name or a "SELECT ... FROM ..." statement that contains spaces
        return spaces ? table : `SELECT * FROM ${table}`
    }
    async _select(id, opts) {
        let [table_id, row_id] = this.iidToSQL(id)
        if (table_id === undefined) return
        let select = this._query_select(table_id)
        let query = `${select} WHERE id = ? LIMIT 1`
        let [rows, cols] = await this.db.execute(query, [row_id])
        let category = this._categories[table_id]  //await this._categories[table_id].reload()
        if (rows.length) return this._convert(rows[0], category)
    }

    async *_scan({offset = 0, limit = 100} = {}) {
        let items = []      // the result list is materialized here to allow ID sorting at the end

        for (let table_id = 0; table_id < this._size; table_id++) {
            let query = this._query_select(table_id)
            if (!query) continue
            if (limit) {
                query += ` LIMIT ${limit}`
                if (offset) query += ` OFFSET ${offset}`        // offset is only allowed together with limit in MySQL
            }

            let [rows, cols] = await this.db.execute(query)
            let category = this._categories[table_id]   //await this._categories[table_id].reload()

            for (let row of rows) {
                let id = this.iidFromSQL(table_id, row.id)
                if (id === undefined || id <= 0) continue
                let item = {id, data: this._convert(row, category)}
                items.push(item)
            }
        }

        items.sort((a, b) => a.id - b.id)
        yield* items
    }

    _delete(id) { return false }

}

// export {MySQL as default}
