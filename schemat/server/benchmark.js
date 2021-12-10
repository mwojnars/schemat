/*
  Benchmarking JS code. The example below taken from: https://jinoantony.com/blog/async-vs-sync-nodejs-a-simple-benchmark
  Test with Apache Bench (ab):
    $ ab -k -c 5 -n 200 "http://localhost:3001/sync"
    $ ab -k -c 5 -n 200 "http://localhost:3001/async"

  Async/sync results: async is 4x faster, perhaps the bcrypt.hash() function is able to utilize multiple cores (?)
  - sync   279.7 ms/request
  - async   72.4 ms/request
*/

import express from 'express'
import bcrypt from 'bcrypt'

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
