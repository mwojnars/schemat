/*
    Schemat CLI: the main entry point to run and manage a Schemat installation.
*/

import path from 'path'
import {fileURLToPath} from 'url'

import yargs from 'yargs'
import {hideBin} from 'yargs/helpers'

import {assert, print} from './utils.js'
import {DB, YamlDB, stackDB} from "./server/db.js";
import {ServerRegistry} from "./server/registry-s.js";
import {ROOT_CID} from "./item.js";
import {Server} from "./server.js";


const __filename = fileURLToPath(import.meta.url)       // or: process.argv[1]
const __dirname  = path.dirname(__filename)


const DB_ROOT   = __dirname + '/database'
const HOST      = '127.0.0.1'
const PORT      =  3000
const WORKERS   =  1 //Math.floor(os.cpus().length / 2)

const IID_SPLIT = 100       // all system items have iid below this value; all custom items have iid >= this value


/**********************************************************************************************************************/

class Schemat {

    constructor(opts) {
        this.opts = opts
    }

    async boot() {
        this.db = stackDB(  //new RingsDB(
            new YamlDB(DB_ROOT + '/db-boot.yaml', {stop_iid:  IID_SPLIT, readOnly: true}),
            new YamlDB(DB_ROOT + '/db-base.yaml', {stop_iid:  IID_SPLIT, readOnly: false}),
            new YamlDB(DB_ROOT + '/db-conf.yaml', {stop_iid:  IID_SPLIT, readOnly: false}),
            new YamlDB(DB_ROOT + '/db-demo.yaml', {start_iid: IID_SPLIT}),
        )
        this.registry = globalThis.registry = new ServerRegistry(this.db)

        await this.db.open()
        await this.registry.boot()
    }

    /*****  Core functionality  *****/

    async run({host, port, workers})        { return new Server(this, {host, port}).serve_cluster(workers) }


    /*****  Admin interface  *****/

    async _build_({path_db_boot}) {
        /* Generate the core "db-boot" database file anew. */
        let {bootstrap} = await import('./server/bootstrap.js')
        let db = new YamlDB(path_db_boot || (DB_ROOT + '/db-boot.yaml'))
        return bootstrap(db)
    }

    async move({id, newid, bottom, db: dbInsert}) {
        /* id, new_iid - strings of the form "CID:IID" */

        function convert(id_)   { return (typeof id_ === 'string') ? id_.split(':').map(Number) : id_ }

        id = convert(id)
        newid = convert(newid)

        let [cid, iid] = id
        let [new_cid, new_iid] = newid
        let sameID = (cid === new_cid && iid === new_iid)

        if ((cid === ROOT_CID || new_cid === ROOT_CID) && cid !== new_cid)
            throw new Error(`cannot change a category item (CID=${ROOT_CID}) to a non-category (CID=${cid || new_cid}) or back`)

        if (!sameID && await this.db.has(newid)) throw new Error(`target ID already exists: [${newid}]`)

        // identify the source DB
        let db = await this.db.find(id)
        if (db === undefined) throw new Error(`item not found: [${id}]`)
        if (db.readOnly) throw new Error(`the DB '${db.name}' containing the [${id}] record is read-only, could not delete the old record after rename`)

        // identify the target DB
        if (dbInsert) dbInsert = this.db.getDB(dbInsert)
        else dbInsert = bottom ? this.db.bottom : db

        if (sameID && db === dbInsert) throw new Error(`trying to move a record [${id}] to the same DB (${db.name}) without change of ID`)

        print(`move: changing item's ID=[${id}] to ID=[${newid}] ...`)

        // load the item from its current ID; save a copy under the new ID, this will propagate to a higher-level DB if `id` can't be stored in `db`
        let data = await db.get(id)
        await dbInsert.put(newid, data)

        if (!sameID) {
            // update children of a category item: change their CID to `new_iid`
            if (cid === ROOT_CID && !sameID)
                for await (let [child_id, _] of this.db.scan(iid))
                    await this.move({id: child_id, newid: [new_iid, child_id[1]]})

            // update references
            let newItem = this.registry.getItem(newid)
            for await (let ref of this.registry.scan()) {           // search for references to `id` in a referrer item, `ref`
                await ref.load()
                ref.data.transform({value: item => item instanceof Item && item.has_id(id) ? newItem : item})
                let jsonData = ref.dumpData()
                if (jsonData !== ref.jsonData) {
                    print(`move: updating reference(s) in item [${ref.id}]`)
                    await this.db.update(ref)      //flush: false
                }
            }
        }

        // remove the old item from DB
        try { await db.del(id) }
        catch (ex) {
            if (ex instanceof DB.ReadOnly) print('WARNING: could not delete the old item as the database is read-only')
        }

        print('move: done')
    }

}

/**********************************************************************************************************************/

async function main() {

    let argv = yargs(hideBin(process.argv))
        .command(
            'run', 'start a Schemat web server', {
                host:       {default: HOST},
                port:       {default: PORT},
                workers:    {default: WORKERS},
            }
        )
        .command(
            'move <id> <newid>',
            // 'move <cid> <iid> <new_iid>',
            'change IID of a given item; update references nested within standard data types; if the item is a category than CID of child items is updated, too',
            // (yargs) => yargs
            //     .positional('cid')
            //     .positional('iid')
            //     .positional('new_iid')
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

    let schemat = new Schemat(argv)
    if (cmd !== '_build_') await schemat.boot()         // _build_ command performs boot (creates registry) on its own

    return schemat[cmd](argv)
}

await main()
