/*
    End-to-end tests for the Schemat application. Run command:

        ./node_modules/.bin/mocha --exit

 */

const wtf = require('wtfnode')
const {expect} = require('chai')
const puppeteer = require('puppeteer')
const http = require('http')
const {exec} = require('child_process')


const HOST = '127.0.0.1'
const PORT = 3001
const DOMAIN = `http://${HOST}:${PORT}`


async function delay(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
}

async function expect_status_ok(page, status = 200) {
    const response = await page.waitForResponse(response => response.status() === status)
    expect(response.ok()).to.be.true
}

function expect_include_all(content, ...strings) {
    for (let str of strings) {
        expect(content).to.include(str)
    }
}

/**********************************************************************************************************************/


describe('Schemat Tests', function () {
    this.timeout(10000)         // Extended timeout for asynchronous tests

    // Start a one-time bootstrap process and check if it completes without errors
    describe('Bootstrap', function () {
        it('bootstrap', function (done) {
            exec('node --experimental-vm-modules cluster/manage.js build', (error, stdout, stderr) => {
                if (error) {
                    console.error('Error during bootstrap:', stderr)
                    done(error)
                } else {
                    // console.log('stdout:', '\n' + stdout)
                    // console.error('stderr:', '\n' + stderr)
                    done()
                }
            })
        })
    })

    describe('Web Application', function () {

        let server, browser, page, pageError

        before(async function () {
            // Start the server...
            // The inner "exec" is necessary to pass the SIGTERM signal to the child "node" process, otherwise the kill()
            // later on will only stop the parent "/bin/sh" process, leaving the "node" process running in the background
            // with all its sockets still open and another re-run of the tests will fail with "EADDRINUSE" error (!)
            server = exec(`exec node --experimental-vm-modules cluster/manage.js --port ${PORT} run`, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error during server startup:', '\n' + stderr)
                } else {
                    console.error('Server stdout:', '\n' + stdout)
                }
            })
            // console.log('Server started:', server.pid)
            await delay(1000)                                   // wait for server to start
            browser = await puppeteer.launch({headless: "new"})
            page = await browser.newPage()
            page.on('pageerror', error => { pageError = error })
        })

        beforeEach(() => {
            pageError = null
        })

        afterEach(() => {
            console.error('Page error:', pageError)
            expect(pageError).to.be.null
        })

        after(async function () {
            await browser.close()
            let killed = server.kill()
            // console.log('Server killed:', killed)
            await delay(200)                                   // wait for server to stop
        })

        it('sys.category:0', async function () {
            await page.goto(`${DOMAIN}/sys.category:0`)
            await expect_status_ok(page)
            expect_include_all(await page.content(), 'Category:0', 'Category of items', 'name', 'cache_ttl', 'fields', 'Ring', 'Varia')
        })

        // Repeat the above it() block for each URL you want to test

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
