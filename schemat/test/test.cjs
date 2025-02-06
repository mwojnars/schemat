/*
    End-to-end tests for the Schemat application. Inside the project root (`src/`) launch:

    $ npm run test          -- for one-time execution of all tests
    $ npm run test:watch    -- for running the tests in watch mode (auto re-run on file changes)

    Also, for counting the number of lines of codes (LOC, KLOC), after `npm install -g cloc`:

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

const HOST = '127.0.0.1'
const PORT = 3001
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

function server_setup(port, args = '') {
    let server, browser, page, messages

    before(async function () {

        // start the server...

        // WARNING: The inner "exec" is NEEDED to pass the SIGTERM signal to the child "node" process, otherwise the kill()
        // later on will only stop the parent "/bin/sh" process, leaving the "node" process running in the background
        // with all its sockets still open and another re-run of the tests will fail with "EADDRINUSE" error (!)
        server = exec(`exec node --experimental-vm-modules schemat/server/run.js --port ${port} ${args}`, (error, stdout, stderr) => {
            if (error) console.error('\nError during server startup:', '\n' + stderr)
            else       console.log('\nServer stdout:', '\n' + stdout)
        })

        // console.log('Server started:', server.pid)
        await delay(1000)                                       // wait for server to start
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
        await browser?.close()
        // let killed = server?.kill()
        // await delay(2000)                                       // wait for server to stop
        
        if (server) {
            const server_exit = new Promise(resolve => {
                server.on('exit', () => resolve())
            })
            server.kill()                           // send SIGTERM to the server
            await server_exit                       // wait for the process to actually exit
            server.removeAllListeners()
            server = null
        }
    })

    return () => ({server, browser, page, messages})
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
    this.timeout(10000)         // Extended timeout for asynchronous tests

    describe('Web Application', function () {

        let setup = server_setup(PORT)
        let server, browser, page, messages

        before(async function () {({server, browser, page, messages} = setup())})

        it('/$/sys', async function () {
            /* Test of React rendering around system-level bootstrap objects. Must be run first, otherwise the error doesn't show up. */
            await test_page(page, `${DOMAIN}/$/id/1009`, '#page-main',
                ['/$/sys', 'system objects', 'Container', 'Site', 'Revision'])
        })

        it('Category', async function () {
            await test_page(page, `${DOMAIN}/$/id/1`, '#page-main',
                ['Category:1', 'Category of objects', 'name', '__ttl', 'defaults', 'schema', 'Ring', 'Varia'])
        })

        it('Varia: load/insert/delete', async function () {
            // navigate to the Varia category page
            await test_page(page, `${DOMAIN}/$/id/5000`, '#page-main',
                ['Category:5000', 'Varia', 'name', '__category', 'schema', 'Varia:5001', 'Create'])

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

        it('rebuild_indexes', async function () {
            await test_page(page, `${DOMAIN}/$/id/5000`, '#page-main')
            await delay(100)
            // let done = await page.evaluate(async () => {
            //     let db = await schemat.db.load()
            //     return db.action.rebuild_indexes()
            // })
            let done = await page.evaluate(() => schemat.eval('schemat.db.rebuild_indexes()'))
            expect(done).to.be.true
        })

        it('Directory', async function () {
            await test_page(page, `${DOMAIN}/$/sys/Directory`, '#page-main',
                ['Directory', 'nested containers', 'file system', 'containers.js:Directory'])
        })

        it('Varia object', async function () {
            await test_page(page, `${DOMAIN}/$/id/5001`, '#page-main', ['Varia', 'title', '__category', 'Ala ma kota', 'Add new entry'])
        })

        it('uncategorized object', async function () {
            await test_page(page, `${DOMAIN}/$/id/5002`, '#page-main', ['title', 'ąłęÓŁŻŹŚ', 'Add new entry'])
        })

        it('static html page', async function () {
            await test_page(page, `${DOMAIN}/$/id/5001::test_html`, null, ['Test Page', 'Headings', 'First item'])
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

        let setup = server_setup(PORT, "--config ./demo/01_books/config.yaml")
        let server, browser, page, messages

        before(async function () {({server, browser, page, messages} = setup())})

        it('demo01/Home', async function () {
            await test_page(page, `${DOMAIN}`, '#page-main', ['home', 'Properties'])
        })
        it('demo01/Authors', async function () {
            await test_page(page, `${DOMAIN}/authors`, null, ['Fitzgerald', 'Gatsby', 'Tolkien', 'Commander'])
        })
        it('demo01/Books', async function () {
            await test_page(page, `${DOMAIN}/books`, null, ['9780743273565', 'Pratchett', '1945'])
        })
        it('demo01/book (Hobbit)', async function () {
            await test_page(page, `${DOMAIN}/book/5004`, null, ['Hobbit', '9780547928227'])
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
