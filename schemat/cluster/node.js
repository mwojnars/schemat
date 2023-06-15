/*
    Node class and a Schemat CLI: the main entry point to run and manage a Schemat node or installation.
    TODO: move out static CLI functionality to another class & file.
*/

import path from 'path'
import {fileURLToPath} from 'url'

import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {T, assert, print} from '../utils.js'
import {Ring, Database} from "../db/database.js";
import {ServerRegistry} from "../server/registry-s.js"
import {Item, ROOT_ID} from "../item.js"
import {WebServer, DataServer} from "./servers.js"
import {JSONx} from "../serialize.js"
import {TotalEdit} from "../db/edits.js"


const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
const __dirname  = path.dirname(__filename) + '/..'


const DB_ROOT   = __dirname + '/database'
const HOST      = '127.0.0.1'
const PORT      =  3000
const WORKERS   =  1 //Math.floor(os.cpus().length / 2)


/**********************************************************************************************************************/

class Node {
    /* A computation node running processes for:
       - processing external web requests
       - internal data handling (storage & access)
     */

    constructor(opts) {
        this.opts = opts
    }

    async boot() {
        let rings = [
            {file: DB_ROOT + '/db-boot.yaml', start_iid:    0, stop_iid:  100, readonly: true},
            {file: DB_ROOT + '/db-base.yaml', start_iid:  100, stop_iid: 1000, readonly: false},
            {file: DB_ROOT + '/db-demo.yaml', start_iid: 1000, stop_iid: null, readonly: false},
            {item: 1015, name: 'mysql', readonly: true},
        ]

        let db = this.db = new Database()
        let registry = await this.createRegistry(db)

        for (const spec of rings) {
            let ring = new Ring(spec)
            await ring.open()
            db.append(ring)
            await registry.boot()   // reload `root` and `site` to have the most relevant objects after a next ring is added
        }
    }

    async createRegistry(db = null) {
        return this.registry = await ServerRegistry.createGlobal(db, __dirname)
    }

    async run({host, port, workers}) {
        // node = this.registry.getLoaded(this_node_ID)
        // return node.activate()     // start the lifeloop and all worker processes (servers)

        // await this._update_all()
        // await this._reinsert_all()

        let web = new WebServer(this, {host, port, workers}).start()
        let data = new DataServer(this).start()
        return Promise.all([web, data])
    }

    async _update_all() {
        /* Convert all the items in the database to a new format; all rings must be set as writable (!) */
        for await (let item of this.registry.scan())
            await this.registry.update(item)
    }

    async _reinsert_all() {
        /* Re-insert every item so that it receives a new ID. Update references in other items. */
        let db = this.db
        for (let ring of db.rings) {
            if (ring.readonly) continue
            let records = await T.arrayFromAsync(ring.scan())
            let ids = records.map(rec => rec.id)

            for (const id of ids) {
                let data = await ring.select([db], id)          // the record might have been modified during this loop - must re-read
                let item = await this.registry.itemFromRecord({id: id, data})
                print(`reinserting item [${id}]...`)
                item.id = undefined
                await ring.insert([db], item)
                print(`...new id=[${item.id}]`)
                await this._update_references(id, item)
                await ring.delete([db], id)
                await ring.block._flush()
            }
        }
    }

    async _update_references(old_id, item) {
        /* Scan all items in the DB and replace references to `old_id` with references to `item`. */
        let db = this.db

        // transform function: checks if a sub-object is an item of ID=old_id and replaces it with `item` if so
        let transform = (it => it instanceof Item && it.id === old_id ? item : it)

        for (let ring of db.rings) {
            for await (const record of ring.scan()) {        // search for references to `old_id` in a referrer item, `ref`

                let id = record.id
                let data = JSONx.transform(record.data, transform)
                if (data === record.data) continue          // no changes? don't update the `ref` item

                if (ring.readonly)
                    print(`...WARNING: cannot update a reference [${old_id}] > [${item.id}] in item [${id}], the ring is read-only`)
                else {
                    print(`...updating reference(s) in item [${id}]`)
                    await db.update(id, new TotalEdit(data))
                    await ring.block._flush()
                }
            }
        }
    }


    /*****  Admin interface  *****/

    async _build_({path_db_boot}) {
        /* Generate the core system items anew and save. */
        let {bootstrap} = await import('../server/bootstrap.js')

        let ring = new Ring({file: path_db_boot || (DB_ROOT + '/db-boot.yaml')})

        await ring.open()
        await ring.erase()

        let registry = await this.createRegistry()
        return bootstrap(registry, ring)
    }

    async move({id, newid, bottom, ring: ringName}) {
        /* id, newid - strings of the form "CID:IID" */

        function convert(id_)   { return (typeof id_ === 'string') ? id_.split(':').map(Number) : id_ }

        id = convert(id)
        newid = convert(newid)

        let db = this.db
        let [cid, iid] = id
        let [new_cid, new_iid] = newid
        let sameID = (cid === new_cid && iid === new_iid)

        if ((cid === ROOT_ID || new_cid === ROOT_ID) && cid !== new_cid)
            throw new Error(`cannot change a category item (CID=${ROOT_ID}) to a non-category (CID=${cid || new_cid}) or back`)

        if (!sameID && await db.select(newid)) throw new Error(`target ID already exists: [${newid}]`)

        // identify the source ring
        let source = await db.findRing({item: id})
        if (source === undefined) throw new Error(`item not found: [${id}]`)
        if (source.readonly) throw new Error(`the ring '${source.name}' containing the [${id}] record is read-only, could not delete the old record after rename`)

        // identify the target ring
        let target = ringName ? await db.findRing({name: ringName}) : bottom ? db.bottom : source

        if (sameID && source === target)
            throw new Error(`trying to move a record [${id}] to the same ring (${source.name}) without change of ID`)

        print(`move: changing item's ID=[${id}] to ID=[${newid}] ...`)

        // load the item from its current ID; save a copy under the new ID, this will propagate to a higher ring if `id` can't be stored in `target`
        let data = await source.select([db], id)
        await target.save([db], null, newid, data)

        if (!sameID) {
            // // update children of a category item: change their CID to `new_iid`
            // if (cid === ROOT_ID && !sameID)
            //     for await (let {id: child_id} of db.scan(iid))
            //         await this.move({id: child_id, newid: [new_iid, child_id[1]]})

            // update references
            let newItem = this.registry.getItem(newid)
            for await (let ref of this.registry.scan()) {           // search for references to `id` in a referrer item, `ref`
                await ref.load()
                ref.data.transform({value: item => item instanceof Item && item.has_id(id) ? newItem : item})
                let dataJson = ref.dumpData()
                if (dataJson !== ref.dataJson) {
                    print(`move: updating reference(s) in item ${ref.id_str}`)
                    await db.update(ref)
                }
            }
        }

        // remove the old item from DB
        try { await source.delete([db], id) }
        catch (ex) {
            if (ex instanceof Ring.ReadOnly) print('WARNING: could not delete the old item as the ring is read-only')
        }

        print('move: done')
    }

}

/**********************************************************************************************************************/

async function main() {

    let argv = yargs(hideBin(process.argv))
        .command(
            'run', 'start a Schemat node', {
                host:       {default: HOST},
                port:       {default: PORT},
                workers:    {default: WORKERS},
            }
        )
        .command(
            'move <id> <newid>',
            'change IID of a given item; update references in other items (if occur inside standard data types)',
            // (yargs) => yargs
            //     .positional('id')
            //     .positional('newid')
        )
        .command(
            '_build_ [path_db_boot]', 'generate the core "db-boot" database anew',
        )
        .option('bottom', {
            alias: 'b',
            description: 'if set, new items are inserted at the lowest possible DB level',
            type: 'boolean'
        })
        .option('db', {
            description: 'name of the DB in a stack where insertion of new items should start (can propagate upwards)',
            type: 'string'
        })

        .demandCommand(1, 'Please provide a command to run.')
        .help().alias('help', 'h')
        .argv

    let commands = [
        'run',
        'move',
        '_build_',
    ]

    let cmd = argv._[0]
    if (!commands.includes(cmd)) return print("Unknown command:", cmd)

    let node = new Node(argv)
    if (cmd !== '_build_') await node.boot()        // _build_ command performs boot (creates registry) on its own

    return node[cmd](argv)
}

await main()
