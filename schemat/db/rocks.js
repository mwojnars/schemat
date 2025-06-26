import {Store} from "./store.js";


class RockStore extends Store {
    /* Local data store based on RocksDB. */
}


/*

// Unfortunately, the basic rocksdb Node.js bindings don’t expose snapshot support directly.
// But if you're not doing high-frequency concurrent writes, a read-only stream is usually sufficient and safe.
// Even if the database is being written to elsewhere, you can open a read-only instance for snapshotting:

    const rocksdb = require('rocksdb');
    const fs = require('fs');
    const yaml = require('js-yaml'); // For YAML output, if needed

    const db = rocksdb('./my-rocksdb-path');

    async function exportToJsonOrYaml({ output = 'backup.json', format = 'json' }) {
      return new Promise((resolve, reject) => {
        const result = {};

        db.open({ readOnly: true }, (err) => {
          if (err) return reject(err);

          const stream = db.createReadStream();

          stream
            .on('data', ({ key, value }) => {
              result[key.toString()] = value.toString(); // adjust encoding if needed
            })
            .on('error', reject)
            .on('end', () => {
              const content =
                format === 'yaml' ? yaml.dump(result) : JSON.stringify(result, null, 2);

              fs.writeFileSync(output, content, 'utf8');
              resolve(`Backup saved to ${output}`);
            });
        });
      });
    }


// If you want more control:

    const yamlContent = yaml.dump(result, { indent: 2, lineWidth: 80 });
    fs.writeFileSync('backup.yaml', yamlContent);

*/
