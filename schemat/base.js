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
        return

        let tables = this.get('tables')
        let table = tables[cid]                         // map CID to the name of a sql table
        table = table.trim()

        let spaces = /\s/g.test(table)                  // `table` is either a table name or a "SELECT ... FROM ..." statement
        let select = spaces ? table : `SELECT * FROM ${table}`

        let [rows, cols] = await this.db.execute(`${select} WHERE id = ? LIMIT 10`, [iid])
        return rows[0]                                  // flat object (encoded) is returned, not a JSON string
    }
    _drop(key, opts) { return false }

    async *_scan(cid) {}

}