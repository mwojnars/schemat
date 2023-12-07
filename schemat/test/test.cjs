/*
    End-to-end tests for the Schemat application. Run command:

        ./node_modules/.bin/mocha --exit

 */

const util = require('util')
const wtf = require('wtfnode')
const {expect, assert} = require('chai')
const puppeteer = require('puppeteer')
const http = require('http')
const {exec} = require('child_process')

// let toString
// (async () => {
//     const utils = await import("../common/utils.js")
//     toString = utils.toString
// })()
// Object.prototype.toString = toString

let print = console.log
let delay = ms => new Promise(resolve => setTimeout(resolve, ms))


/**********************************************************************************************************************/

const HOST = '127.0.0.1'
const PORT = 3000
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

async function test_react_page(page, url, selector = null, strings = []) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await expect_status_ok(page)

    expect_include_all(await page.content(), ...strings)

    if (selector && strings.length) {
        // determining that React has rendered the component in full is tricky, hence we use several methods...
        await page.waitForSelector(selector, {visible: true})       // wait for a React element to be present and visible (non-empty), which means in practice that it started rendering
        await delay(300)                                            // wait for a short time to allow the component to render fully
        // await page.waitForFunction(() => document.querySelector(selector)?.textContent.includes('Expected Text'))

        expect_include_all(await page.content(), ...strings)
    }
}

/**********************************************************************************************************************/


describe('Schemat Tests', function () {
    this.timeout(10000)         // Extended timeout for asynchronous tests

    // // Start a one-time bootstrap process and check if it completes without errors
    // describe('Bootstrap', function () {
    //     it('bootstrap', function (done) {
    //         exec('node --experimental-vm-modules cluster/manage.js build', (error, stdout, stderr) => {
    //             if (error) {
    //                 console.error('Error during bootstrap:', stderr)
    //                 done(error)
    //             } else {
    //                 // console.log('stdout:', '\n' + stdout)
    //                 // console.error('stderr:', '\n' + stderr)
    //                 done()
    //             }
    //         })
    //     })
    // })

    describe('Web Application', function () {

        let server, browser, page, messages

        before(async function () {
            // Start the server...
            // The inner "exec" is necessary to pass the SIGTERM signal to the child "node" process, otherwise the kill()
            // later on will only stop the parent "/bin/sh" process, leaving the "node" process running in the background
            // with all its sockets still open and another re-run of the tests will fail with "EADDRINUSE" error (!)
            server = exec(`exec node --experimental-vm-modules cluster/manage.js --port ${PORT} run`, (error, stdout, stderr) => {
                if (error) {
                    console.error('\nError during server startup:', '\n' + stderr)
                } else {
                    console.error('\nServer stdout:', '\n' + stdout)
                }
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
        })

        beforeEach(() => { messages = [] })

        afterEach(async () => {
            await page.waitForNetworkIdle()                         // wait for page to render completely
            // await page.waitForNetworkIdle({ idleTime: 500, timeout: 5000 })
            // await delay(2000)

            for (let msg of messages)
                console.log(`Console [${msg.type()}]: `, msg.text())

            let error = messages.find(msg => msg.type() === 'error')
            assert(!error, `client-side error: ${error?.text()}`)

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
            await browser.close()
            let killed = server.kill()
            // console.log('Server killed:', killed)
            await delay(200)                                        // wait for server to stop
        })

        it('Category', async function () {
            await test_react_page(page, `${DOMAIN}/sys.category:0`, '#page-component',
                ['Category:0', 'Category of items', 'name', 'cache_ttl', 'fields', 'Ring', 'Varia'])
        })

        it('Varia', async function () {
            await test_react_page(page, `${DOMAIN}/sys.category:1000`, '#page-component',
                ['Category:1000', 'Varia', 'name', '_category_', 'fields', 'Varia:1016', 'Create Item'])
        })

        it('varia item', async function () {
            await test_react_page(page, `${DOMAIN}/system/object/1016`, '#page-component',
                ['Varia', 'title', '_category_', 'Ala ma kota', 'Add new entry'])
        })

        it('varia item', async function () {
            await test_react_page(page, `${DOMAIN}/system/object/1017`, '#page-component',
                ['title', 'ąłęÓŁŻŹŚ', 'Add new entry'])
        })

        // describe('UI Actions on sys.category:1000', function () {
        //     before(async function () {
        //         await page.goto('http://127.0.0.1:3000/sys.category:1000')
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

    // after(function (done) {
    //     console.log()
    //     setTimeout(() => {
    //         wtf.dump()              // list the open handles that are keeping the event loop active
    //         done()
    //     }, 100)                     // set timeout to allow all resources to close properly
    // })
})
