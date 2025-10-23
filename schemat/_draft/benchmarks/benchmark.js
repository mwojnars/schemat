/*
  Benchmarking JS code.
*/

import express from 'express'
import bcrypt from 'bcrypt'


/**********************************************************************************************************************/

async function timeitAsync(label, repeat, fun) {
    // assert(typeof label === 'string')
    console.time(label)
    for (let i = 0; i < repeat; i++)
        await fun()
        // fun()
    console.timeEnd(label)
    // setImmediate(() => console.timeEnd(label))
}
function timeit(label, repeat, fun) {
    console.time(label)
    for (let i = 0; i < repeat; i++)
        fun()
    console.timeEnd(label)
}


/**********************************************************************************************************************
 **
 **  BENCHMARKS
 **
 */

function bench001() {
    /*
      Example taken from: https://jinoantony.com/blog/async-vs-sync-nodejs-a-simple-benchmark
      Test with Apache Bench (ab):
        $ ab -k -c 5 -n 200 "http://localhost:3001/sync"
        $ ab -k -c 5 -n 200 "http://localhost:3001/async"

      Async/sync results: async is 4x faster, perhaps the bcrypt.hash() function is able to utilize multiple cores (?)
      - sync   279.7 ms/request
      - async   72.4 ms/request
    */
    const app = express()

    app.get('/sync', (req, res) => {
        let hashed = bcrypt.hashSync('secret', 10)
        return res.send(hashed)
    })

    app.get('/async', async (req, res) => {
        let hashed = await bcrypt.hash('secret', 10)
        return res.send(hashed)
    })

    app.listen(3001, () => console.log('Server started on port 3001'))
}

async function bench002(M = 1000000, N = 100) {
    /* Based on:  https://madelinemiller.dev/blog/javascript-promise-overhead/
       Results posted at:  https://stackoverflow.com/a/70310025/1202674
     */
    function fibonacci_sync(num) {
        let a = 1, b = 0, temp
        while (num >= 0) { temp = a; a = a + b; b = temp; num-- }
        return b
    }
    async function fibonacci_async(num) {
        let a = 1, b = 0, temp
        while (num >= 0) { temp = a; a = a + b; b = temp; num-- }
        return b
    }
          timeit     ('sync   ', M,       () => {for(let i = 0; i < N; i++) fibonacci_sync(i)})
    await timeitAsync('async  ', M, async () => {for(let i = 0; i < N; i++) await fibonacci_async(i)})
    // await timeitAsync('promise', M, async () => {  // chain of Promises over sync functions with a single "await" at the end
    //     let p = Promise.resolve()
    //     for(let i = 0; i < N; i++) p = p.then(()=>fibonacci_sync(i))
    //     await p
    // })
}

/**********************************************************************************************************************/

function bench003(playCount = 0) {
    /* Results @node.js v16.13.1:
       1) playCount=0 (pure create() vs pure setPrototypeOf(), no object manipulation):
            Object.create:             4.8
            Object.setPrototypeOf:   129.8
       2) playCount=1:
            Object.create:           819.0
            Object.setPrototypeOf:   945.8      <-- slowdown is visible, but comparable to a one-iteration loop
       3) playCount=10:
            Object.create:           4656.4
            Object.setPrototypeOf:   4828.6     <-- slowdown is negligible
       4) playCount=30:
            Object.create:           13869.4
            Object.setPrototypeOf:   13919.2
     */
    function A() {
        let obj = Object.create(A.prototype)
        obj.value = true
        return obj
    }
    A.prototype.yes = function () { return this.value }

    function B() {
        let obj = {}
        Object.setPrototypeOf(obj, B.prototype)
        obj.value = true
        return obj
    }
    B.prototype.yes = function () { return this.value }

    function playwith(x) {
        if (!playCount) return
        for(let i = 0; i < playCount; i++) {
            x[`attr_${i}`] = i
            x.yes()
        }
        for(let i = 0; i < playCount; i++) {
            delete x[`attr_${i}`]
            x.yes()
        }
    }

    let runs = 5
    let iterations = [10e5, 10e6] //, 10e7]
    let results = {}

    iterations.forEach(function (iterate) {
        let i, start

        if (!results[iterate]) results[iterate] = { a: 0, b: 0 }
        start = new Date()

        for(i = 0; i < iterate; i++) {
            let a = new A()
            if (a.yes() !== true) throw new Error('incorrect output @ ' + i)
            playwith(a)
        }
        results[iterate].a += new Date() - start
        start = new Date()

        for(i = 0; i < iterate; i++) {
            let b = new B()
            if (b.yes() !== true) throw new Error('incorrect output @ ' + i)
            playwith(b)
        }
        results[iterate].b += new Date() - start
    })

    iterations.forEach(function (iterate) {
        let a = results[iterate].a / runs
        let b = results[iterate].b / runs

        console.log('Iteration(s):           ', iterate)
        console.log('==================================')
        console.log('Object.create:          ', a)
        console.log('Object.setPrototypeOf:  ', b)
        console.log('')
    })
}

/**********************************************************************************************************************/

function bench004(M = 10, N = 1000000) {
    /*
        map set-get: 1.671s
        map set-del(front): 2.544s
        map set-del(back): 2.551s
        map set-del(back)-set: 3.475s
    */
    timeit('map set-get', M, () => {
        let map = new Map()
        for (let i = 0; i < N; i++) map.set(`${i}`, i)
        for (let i = 0; i < N; i++) map.get(`${i}`)
    })
    timeit('map set-del(front)', M, () => {
        let map = new Map()
        for (let i = 0; i < N; i++) map.set(`${i}`, i)
        for (let i = 0; i < N; i++) map.delete(`${N-i-1}`)
    })
    timeit('map set-del(back)', M, () => {
        let map = new Map()
        for (let i = 0; i < N; i++) map.set(`${i}`, i)
        for (let i = 0; i < N; i++) map.delete(`${i}`)
    })
    timeit('map set-del(back)-set', M, () => {
        let map = new Map()
        for (let i = 0; i < N; i++) map.set(`${i}`, i)
        for (let i = 0; i < N; i++) { map.delete(`${i}`); map.set(`${i}`, i) }
    })
}

/**********************************************************************************************************************/

// await bench002()
bench004()
