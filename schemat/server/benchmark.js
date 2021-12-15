/*
  Benchmarking JS code.
*/

import express from 'express'
import bcrypt from 'bcrypt'


/**********************************************************************************************************************/

async function timeit(label, repeat, fun) {
    // assert(typeof label === 'string')
    console.time(label)
    for (let i = 0; i < repeat; i++)
        await fun()
        // fun()
    console.timeEnd(label)
    // setImmediate(() => console.timeEnd(label))
}
function timeitSync(label, repeat, fun) {
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
    /* Based on: https://madelinemiller.dev/blog/javascript-promise-overhead/ */
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
    timeitSync  ('sync   ', M,       () => {for(let i = 0; i < N; i++) fibonacci_sync(i)})
    await timeit('async  ', M, async () => {for(let i = 0; i < N; i++) await fibonacci_async(i)})
    // await timeit('promise', M, async () => {  // chain of Promises over sync functions with a single "await" at the end
    //     let p = Promise.resolve()
    //     for(let i = 0; i < N; i++) p = p.then(()=>fibonacci_sync(i))
    //     await p
    // })
}

/**********************************************************************************************************************/

await bench002()

