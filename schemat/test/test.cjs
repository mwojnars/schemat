/*
    End-to-end tests for the Schemat application. Run command:

        ./node_modules/.bin/mocha

 */

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

/**********************************************************************************************************************/


describe('Schemat Tests', function () {
    this.timeout(30000)         // Extended timeout for asynchronous tests

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
    // it('bootstrap generation', async function () {
    //     await new Promise((resolve, reject) => {
    //         exec('node --experimental-vm-modules cluster/manage.js build', (error, stdout, stderr) => {
    //             if (error) {
    //                 console.error(`exec error: ${error}`)
    //                 return reject(error)
    //             }
    //             console.log(`stdout: ${stdout}`)
    //             console.error(`stderr: ${stderr}`)
    //             resolve()
    //         })
    //     })
    // })

    describe('Web Application', function () {

        let server
        let browser
        let page

        before(async function () {
            // Start the server
            server = exec(`node --experimental-vm-modules cluster/manage.js --port ${PORT} run`)
            await delay(1000)                                   // wait for server to start
            browser = await puppeteer.launch({headless: "new"})
            page = await browser.newPage()
        })

        after(async function () {
            await browser.close()
            server.kill()
        })

        it('sys.category:0', async function () {
            await page.goto(`${DOMAIN}/sys.category:0`)
            const response = await page.waitForResponse(response => response.status() === 200)
            expect(response.ok()).to.be.true
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
})
