import {server} from "./server.js";

const WORKERS = 1 //Math.floor(os.cpus().length / 2)


await server.serve_cluster(WORKERS)

