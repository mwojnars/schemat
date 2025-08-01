/*
    End-to-end tests for the Schemat application. Inside the project root (`src/`) launch:

    $ npm run test          -- for one-time execution of all tests
    $ npm run test:watch    -- for running the tests in watch mode (auto re-run on file changes)

    Also, for counting the number of lines of code (LOC, KLOC), after `npm install -g cloc`:

    $ cloc schemat/
 */

const https = require('https')
const util = require('util')
const wtf = require('wtfnode')
const {expect, assert} = require('chai')
const puppeteer = require('puppeteer')
const http = require('http')
const {exec} = require('child_process')

/**********************************************************************************************************************/

// let toString
// (async () => {
//     const utils = await import("../common/utils.js")
//     toString = utils.toString
// })()
// Object.prototype.toString = toString

let print = console.log
let delay = ms => new Promise(resolve => setTimeout(resolve, ms))


function check_internet(fail, retries = 2) {
    /* Check that internet connection is available, otherwise the tests hang (even if running on localhost). */
    const fail_or_retry = (retries > 0) ? () => check_internet(fail, retries-1) : fail
    const req = https.get('https://www.google.com/generate_204', {timeout: 5000}, (res) => {
        if (res.statusCode !== 204) fail_or_retry()
        req.destroy()                                  // terminate the request to avoid downloading the entire page
    }).on('error', fail_or_retry)
}

/**********************************************************************************************************************/

const NODE = 1024           // ID of the Node object that should be loaded upon start up  ... 1036 is missing in Demo database
const HOST = '127.0.0.1'
const PORT = 2998
const TCP_PORT = 5828
const DOMAIN = `http://${HOST}:${PORT}`


async function expect_status_ok(page, status = 200) {
    const response = await page.waitForResponse(response => response.status() === status)
    expect(response.ok()).to.be.true
}

function expect_include_all(content, ...strings) {
    for (let str of strings) {
        expect(content).to.include(str)
    }
}

function extract_content_of_node(node) {
    /* Extract plaintext content of a DOM node *including* shadow-DOM subtrees (Puppeteer's page.content() does NOT include them!). */
    let parts = []

    if (node.shadowRoot)
        parts.push(extract_content_of_node(node.shadowRoot))
    else
        for (const child of node.childNodes)
            if (child.nodeType === Node.TEXT_NODE)
                parts.push(child.textContent)
            else
                parts.push(extract_content_of_node(child))

    return parts.join('')
}

async function extract_content(page) {
    // page.evaluate() executes in the browser context, without access to Node.js scope,
    // hence the extract_content_of_node() function's code must be pasted directly in the function to be executed
    return await page.evaluate(new Function(`
                    ${extract_content_of_node.toString()}
                    return extract_content_of_node(document.body)
                `))
}

async function test_page(page, url, react_selector = null, strings = [])
{
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await expect_status_ok(page)

    expect_include_all(await extract_content(page), ...strings)

    if (react_selector && strings.length) {
        // determining that React has rendered the component in full is tricky, hence we use several methods...
        await page.waitForSelector(react_selector, {visible: true})     // wait for a React element to be present and visible (non-empty), which means in practice that it started rendering
        await delay(300)                                                // wait for a short time to allow the component to render fully
        // await page.waitForFunction(() => document.querySelector(react_selector)?.textContent.includes('Expected Text'))

        let content = await extract_content(page)   //await page.content()
        expect_include_all(content, ...strings)
    }
    return page
}

/**********************************************************************************************************************/

async function wait_for_port_release(port, retries = 10, delay_ms = 1000) {
    for (let i = 0; i < retries; i++)
        try {
            await new Promise((resolve, reject) => {
                const server = http.createServer()
                server.on('error', reject)
                server.on('listening', () => server.close(() => resolve()))
                server.listen(port)
            })
            return true
        } catch (err) {
            if (i === retries - 1) throw new Error(`Port ${port} is still in use after ${retries} attempts`)
            await delay(delay_ms)
        }
}

async function start_server(node, port, tcp_port, args = '') {
    await wait_for_port_release(port)           // wait for port to be released before starting new server

    let opts = `--node ${node} --port ${port} ${args}`
    let command = `exec node --expose-gc --trace-uncaught --trace-warnings schemat/server/run.js ${opts}`

    // WARNING: The inner "exec" is NEEDED to pass the SIGTERM signal to the child "node" process, otherwise the kill()
    // later on will only stop the parent "/bin/sh" process, leaving the "node" process running in the background
    // with all its sockets still open and another re-run of the tests will fail with "EADDRINUSE" error (!)
    return exec(command,
        {maxBuffer: 1024 * 1024 * 10},  // capture full output, 10MB buffer
        (error, stdout, stderr) => {
            if (error) console.error('\nSchemat server error:', error)
            // if (stderr) console.error('\nSchemat server stderr:', '\n' + stderr)
            // if (stdout) console.log('\nSchemat server stdout:', '\n' + stdout)
        })
}

function server_setup({nodes = null, node = NODE, port = PORT, tcp_port = TCP_PORT, args = ''} = {}) {
    let server, servers = [], browser, page, messages

    before(async function() {
        nodes ??= [node]

        for (let node of nodes) {
            let srv = await start_server(node, port++, tcp_port++, args)
            servers.push(srv)
            srv.stdout.pipe(process.stdout)                     // pipe output in real-time
            srv.stderr.pipe(process.stderr)
        }
        server = servers[0]

        await delay(3000)                                       // wait for server to start
        browser = await puppeteer.launch({headless: "new"})
        page = await browser.newPage()

        // page.on('pageerror', error => {
        //     if (!error) { console.log('NO ERROR (!?)'); return }
        //     page_error = error
        //     console.log(`Error [${error.type()}]: `, error.text())
        //     // console.log(Object.prototype.toString.call(error))
        //     // for (const property in error) { console.log(`${property}: ${error[property]}`) }
        //     // console.log(util.inspect(page_error, { showHidden: false, depth: null, colors: true }))
        // })

        page.on('console', msg => { messages.push(msg) })
        page.on('pageerror', error => { messages.push({type: () => 'error', text: () => error}) })
        await delay(1500)
    })

    beforeEach(() => { messages = [] })

    afterEach(async () => {
        await page.waitForNetworkIdle()                         // wait for page to render completely
        // await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 })
        // await delay(2000)

        for (let msg of messages)
            msg.type ? console.log(`Console [${msg.type()}]: `, msg.text()) : console.log(msg)

        let error = messages.find(msg => msg.type?.() === 'error')
        assert(!error, `(on client) ${error?.text() || error}`)

        // if (page_error) {
        //     console.log('\nPage error:', JSON.stringify(page_error))
        //     // console.log('\nPage error:', util.inspect(page_error, { showHidden: false, depth: null }))
        //     // console.log('Page error message:', page_error.message);
        //     // console.log('Page error stack trace:\n', page_error.stack);
        //     // console.error('\nPage error:', page_error, '\n')
        // }
        // expect(page_error).to.be.null
    })

    after(async function () {
        this.timeout(30000)
        print(`TESTS after(): closing browser...`)
        await browser?.close()

        let exiting = servers.toReversed().map(server => {
            let name = server.spawnargs?.[2]?.match(/node\.\d+/)?.[0]
            server.removeAllListeners()
            let exit = new Promise(resolve => server.on('exit', () => {
                print(`TESTS after(): ${name} exited`)
                resolve()
            }))
            print(`TESTS after(): waiting for ${name} to exit...`)
            server.kill()               // send SIGTERM
            return exit
        })
        await Promise.all(exiting)      // wait for server processes to actually exit
    })

    return () => ({server, servers, browser, page, messages})
}


/**********************************************************************************************************************/

describe('Environment Checks', function() {
    it('Node.js version', function() {
        const ver = process.version
        console.log('    Current Node.js version:', ver)
        assert.ok(ver)
    })
    it('Internet connection', function() {
        // internet connection must be available even for tests that run on localhost, otherwise they hang
        check_internet(() => { throw new Error('NO INTERNET CONNECTION. Terminating.') })
    })
})


describe('Schemat Tests', function () {
    this.timeout(15000)         // Extended timeout for asynchronous tests

    describe('Web Application', function () {

        let setup = server_setup({nodes: ['sample/node.1024', 'sample/node.1036']})
        let server, browser, page, messages

        before(async function () {({server, browser, page, messages} = setup())})

        // it('/$/sys', async function () {
        //     /* Test of React rendering around system-level bootstrap objects. Must be run first, otherwise the error doesn't show up. */
        //     await delay(500)
        //     await test_page(page, `${DOMAIN}/$/id/1009`, '#page-main',
        //         ['/$/sys', 'system objects', 'Directory'])
        // })

        it('Category', async function () {
            await test_page(page, `${DOMAIN}/$/id/1`, '#page-main',
                ['Category of objects', 'name', '__ttl', 'defaults', 'schema', 'Ring', 'Varia', 'schemat:Category'])
        })

        it('Varia: load/insert/delete (UI)', async function () {
            // navigate to the Varia category page
            await test_page(page, `${DOMAIN}/$/id/2101`, '#page-main',
                ['Varia', 'Category', 'name', '__category', 'schema', 'Varia:2102', 'Create'])

            // these strings are only available after client-side rendering, not in HTML source:
            expect_include_all(await extract_content(page), 'check', 'Varia.code')

            // type the name of the new item
            const input = 'input[name="name"]'
            await page.waitForSelector(input, {visible: true})
            await delay(100)            // without this delay, the typing of 'TestItem' has no effect and the name submitted is empty!

            const name = `TestItem_${Math.floor(Math.random() * 10000)}`
            await page.focus(input)
            await page.type(input, `${name}_(&$%#@!^)`)

            // click the "Create" button
            await page.click('button[type="submit"]')
            await delay(100)

            // check that the new item's name showed up
            let page_content = await extract_content(page)
            expect(page_content).to.include(name)

            // check that the new item's name showed up as a link
            const test_item_exists = await page.evaluate((_name) => {
                const links = Array.from(document.querySelectorAll('a:not(input)'))
                return links.some(link => link.textContent.includes(_name))
            }, name)
            expect(test_item_exists).to.be.true

            // find and click the "Delete" button next to the newly created item
            let delete_buttons = await page.$x(`//*[contains(text(), '${name}')]/following::button`)
            expect(delete_buttons.length).to.be.greaterThan(0)
            await delete_buttons[0].click()
            await delay(100)

            // check that the new item disappeared from the list
            let updated_content = await extract_content(page)
            expect(updated_content).to.not.include(name)
        })

        it('Varia: multiple insert (console)', async function () {
            await test_page(page, `${DOMAIN}/$/id/2101`, '#page-main')
            await delay(200)

            let inserted = await page.evaluate(async () => {
                let Varia = schemat.object
                let d = await Varia.new().save()
                let a = Varia.new()
                let c = Varia.new()
                // let e = window.e = Varia.new()
                let b = a.ref = Varia.new({ref: a}) //, strong_ref: e})
                c.delete_self()
                d.ref = b
                await schemat.save()
                window.a = a = await a.reload()
                window.b = b = await b.reload()
                window.d = d
                return a.ref.is(b) && b.ref.is(a) && d.ref.is(b)
            })
            expect(inserted).to.be.true

            let deleted = await page.evaluate(async () => {
                let a = window.a
                let b = window.b
                let d = window.d
                a.delete_self()
                b.delete_self()
                d.delete_self()
                await schemat.save()
                // await window.e.reload()     // fails because `e` was cascade-deleted via `b`
                return true
            })
            expect(deleted).to.be.true
        })

        it('rebuild_indexes', async function () {
            // await delay(200)
            await test_page(page, `${DOMAIN}/$/id/2101`, '#page-main')
            await delay(200)
            let done = await page.evaluate(() => schemat.server('schemat.db.rebuild_indexes()'))
            expect(done).to.be.true
        })

        // it('Directory', async function () {
        //     await test_page(page, `${DOMAIN}/$/sys/Directory`, '#page-main',
        //         ['Directory', 'nested containers', 'file system', 'containers.js:Directory'])
        //     await delay(1000)
        // })

        it('Varia object', async function () {
            await test_page(page, `${DOMAIN}/$/id/2102`, '#page-main', ['Varia', 'title', '__category', 'Ala ma kota', 'Add new entry'])
        })

        it('uncategorized object', async function () {
            await test_page(page, `${DOMAIN}/$/id/2104`, '#page-main', ['title', 'ąłęÓŁŻŹŚ', 'Add new entry'])
        })

        it('static html page', async function () {
            await test_page(page, `${DOMAIN}/$/id/2102::test_html`, null, ['Test Page', 'Headings', 'First item'])
        })

        it('robots.txt', async function () {
            const response = await page.goto(`${DOMAIN}/robots.txt`)
            expect(response.status()).to.equal(200)
            const content = await response.text()
            expect(content).to.include('User-agent:')
        })

        // describe('UI Actions on $/id/1000', function () {
        //     before(async function () {
        //         await page.goto('http://127.0.0.1:3000/$/id/1000')
        //     })
        //
        //     it('should add an item and verify it appears in the list', async function () {
        //         await page.type('input[name="name"]', 'abc')
        //         await page.click('button#create-item')
        //         let itemText = await page.evaluate(() => document.querySelector('.item-list .item:last-child').textContent)
        //         expect(itemText).to.include('abc')
        //     })
        //
        //     it('should remove the newly added item', async function () {
        //         await page.click('.item-list .item:last-child .delete-button')
        //         // Verify the item was removed as expected
        //     })
        //
        //     it('should edit the "Varia" item and check the change', async function () {
        //         await page.dblclick('.item-list .item:first-child .name')
        //         await page.keyboard.type('Varia-edited')
        //         await page.keyboard.press('Enter')
        //         await page.reload()
        //         let headerText = await page.evaluate(() => document.querySelector('h1').textContent)
        //         expect(headerText).to.equal('Varia-edited')
        //     })
        //
        //     // ...additional tests for reverting the change
        // })
    })

    describe('Demo 01', function () {

        let setup = server_setup({nodes: ['demo-01/node.1024']})
        let server, browser, page, messages

        before(async function () {({server, browser, page, messages} = setup())})

        it('demo01/Home::inspect', async function () {
            await delay(500)
            await test_page(page, `${DOMAIN}/::inspect`, '#page-main', ['home', 'Properties'])
        })
        it('demo01/Home', async function () {
            await test_page(page, `${DOMAIN}`, null, ['Welcome', 'Tolkien', 'View All Authors'])
        })
        it('demo01/Authors', async function () {
            await test_page(page, `${DOMAIN}/authors`, null, ['Fitzgerald', 'Gatsby', 'Tolkien', 'Commander'])
        })
        it('demo01/Books', async function () {
            await test_page(page, `${DOMAIN}/books`, null, ['9780743273565', 'Pratchett', '1945'])
        })
        it('demo01/book (Hobbit)', async function () {
            await test_page(page, `${DOMAIN}/book/2105`, null, ['Hobbit', '9780547928227'])
        })
    })

    after(function() {
        console.log(`\nTests completed at: ${new Date().toLocaleString()}`)
    })

    // after(function (done) {
    //     console.log()
    //     setTimeout(() => {
    //         wtf.dump()              // list the open handles that are keeping the event loop active
    //         done()
    //     }, 100)                     // set timeout to allow all resources to close properly
    // })
})
