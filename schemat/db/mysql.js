// import mysql from 'mysql2'
import { assert, print } from '../utils.js'
import { Block } from './storage.js'

//let db = mysql.createConnection(srv)
//db.connect()
//db.query('SELECT id, pid, title FROM pap_papers_view WHERE id>=9035 AND id < 9050', (e,r,f) => console.log(r))

// let srv = {host: '127.0.0.1', port: '3307', user: 'paperity', database: 'paperity', password: '......'}
// let db = await mysql.createConnection(srv)
// let [rows, fields] = await db.execute('SELECT id, pid, title FROM pap_papers_view WHERE id>=9035 AND id < 9050')


export class MySQL extends Block {

    _sqlTables              // array of SQL table names
    _categories             // array of Category items corresponding to SQL tables; TODO: enable reload of category items

    get _offset() { return this.prop('offset') || 0 }
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
        let conn = this.prop('connection') || {}
        let args = this.propObject('host', 'port', 'user', 'database', 'password')
        return this._mod_mysql.createConnection({...opts, ...conn, ...args})      // individual parameters, if defined, override the 'connection' object
    }

    iidToSQL(iid) {
        /* Mapping Schemat IID to a SQL table name and row ID. */
        if (iid < this._offset) return []
        let row_id = Math.floor((iid - this._offset) / this._size)
        let table_id = (iid - this._offset) % this._size
        return [table_id, row_id]
    }
    iidFromSQL(table_id, row_id) {
        /* Mapping SQL table and row ID to Schemat IID. */
        return this._offset + row_id * this._size + table_id
    }

    ////////////////////////////////////////////////////////////////////

    async _initTables() {
        /* Compute the mapping of CID numbers to SQL table names and return as a Map object. */
        let tables = this.prop('tables')
        this._sqlTables = []
        this._categories = []

        for (let {key: path, value: sqlTable} of tables.entries()) {
            assert(path)
            let category = await this.registry.site.findItem(path)
            assert(category.isLoaded)
            assert(category.isCategory)

            this._sqlTables.push(sqlTable)
            this._categories.push(category)
        }
        // print('MySQL._sqlTables:', this._sqlTables)
        // print('MySQL._categories:', this._categories.map(c => c.prop('name')))
    }

    _convert(row, category) {
        /* Clean and convert a `row` of data to JSON string compatible with the category's schema. */
        let schema = category.getItemSchema()
        let keys   = Object.keys(row)
        for (let key of keys) if (!schema.has(key)) delete row[key]     // drop DB fields with no corresponding category field
        row['__category__'] = {'@': category.id}
        return JSON.stringify(row)                                      // flat object (encoded) from DB is converted to a JSON string
    }

    _query_select(table_id) {
        /* Build the SELECT... FROM... part of a query for a given CID. Return undefined if this particular CID is unsupported. */
        let table = this._sqlTables[table_id]
        table = table.trim()
        let spaces = /\s/g.test(table)                  // `table` is either a table name or a "SELECT ... FROM ..." statement that contains spaces
        return spaces ? table : `SELECT * FROM ${table}`
    }
    async _select([cid, iid], opts) {
        let [table_id, row_id] = this.iidToSQL(iid)
        if (table_id === undefined) return
        let select = this._query_select(table_id)
        let query = `${select} WHERE id = ? LIMIT 1`
        let [rows, cols] = await this.db.execute(query, [row_id])
        let category = await this._categories[table_id].refresh()
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
            let category = await this._categories[table_id].refresh()
            let cid = category.iid

            for (let row of rows) {
                let iid = this.iidFromSQL(table_id, row.id)
                let item = {id: [cid, iid], data: this._convert(row, category)}
                items.push(item)
            }
        }

        items.sort((a, b) => a.id[1] - b.id[1])
        yield* items
    }

    ////////////////////////////////////////////////////////////////////

    // async _select([cid, iid], opts) {
    //     let select = this._select_sql(cid)
    //     if (!select) return
    //     let query = `${select} WHERE id = ? LIMIT 1`
    //     let [rows, cols] = await this.db.execute(query, [iid])
    //     if (rows.length) return this._convert(rows[0], cid)
    // }
    //
    // async *_scan({offset = 0, limit = 100} = {}) {
    //     for (let cid of this._sqlTables.keys()) {
    //         let query = this._select_sql(cid)
    //         if (!query) continue  //return
    //         if (limit) {
    //             query += ` LIMIT ${limit}`
    //             if (offset) query += ` OFFSET ${offset}`        // offset is only allowed together with limit in MySQL
    //         }
    //         let [rows, cols] = await this.db.execute(query)
    //         for (let row of rows)
    //             yield {id: [cid, row.id], data: await this._convert(row, cid)}
    //     }
    // }
    //
    // async _initTables() {
    //     /* Compute the mapping of CID numbers to SQL table names and return as a Map object. */
    //     let tables = this.prop('tables')
    //     let sqlTables = new Map()
    //     for (let {key: path, value: sqlTable} of tables.entries()) {
    //         assert(path)
    //         let cat = await this.registry.site.findItem(path)
    //         assert(cat.isCategory)
    //         sqlTables.set(cat.iid, sqlTable)
    //     }
    //     // print('MySQL._sqlTables:', sqlTables)
    //     this._sqlTables = sqlTables
    // }
    //
    // _select_sql(cid) {
    //     /* Build the SELECT... FROM... part of a query for a given CID. Return undefined if this particular CID is unsupported. */
    //     let table = this._sqlTables.get(cid)
    //     if (!table) return
    //     table = table.trim()
    //     let spaces = /\s/g.test(table)                  // `table` is either a table name or a "SELECT ... FROM ..." statement that contains spaces
    //     return spaces ? table : `SELECT * FROM ${table}`
    // }
    // async _convert(row, cid) {
    //     /* Clean and convert a `row` of data to JSON string compatible with the category's schema. */
    //     let category = await this.registry.getCategory(cid)
    //     let schema = category.getItemSchema()
    //     let keys   = Object.keys(row)
    //     for (let key of keys) if (!schema.has(key)) delete row[key]     // drop DB fields with no corresponding category field
    //     row['__category__'] = {'@': category.id}
    //     return JSON.stringify(row)                                      // flat object (encoded) from DB is converted to a JSON string
    // }

    _delete(id) { return false }

}

// export {MySQL as default}
