//a tiny local http server that plays the part of the repository for the update tests

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ultrayt-test-'))
}

//a minimal valid bundle for the version, extra files can be added or replaced through `files`
function makeBundle(version, files = {}) {
    const all = {
        'package.json': JSON.stringify({ name: 'ultrayt', version, main: 'src/boot.js' }),
        'src/index.js': `module.exports = ${JSON.stringify(version)}`,
        ...files
    }

    const encoded = {}
    for (const [ rel, content ] of Object.entries(all)) {
        if (content !== null) encoded[rel] = Buffer.from(content).toString('base64')
    }

    return zlib.gzipSync(Buffer.from(JSON.stringify({ version, files: encoded })))
}

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex')
}

//serves /version.json and /updates/app.json.gz
//options: version, bundle, sha256 (override), url (override), corruptBundle (serves different bytes than the checksum was made for)
function startFeedServer({ version, bundle, sha256: sha = sha256(bundle), url = 'updates/app.json.gz', corruptBundle = false }) {
    const served = corruptBundle ? Buffer.concat([ bundle, Buffer.from('x') ]) : bundle

    const server = http.createServer((req, res) => {
        if (req.url === '/version.json') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ version, url, sha256: sha, size: bundle.length, notes: 'test' }))
        } else if (req.url === '/updates/app.json.gz') {
            res.setHeader('Content-Type', 'application/gzip')
            res.end(served)
        } else {
            res.statusCode = 404;
            res.end('not found')
        }
    })

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port
            resolve({
                port,
                feedUrl: `http://127.0.0.1:${port}/version.json`,
                close: () => new Promise((done) => {
                    server.closeAllConnections?.()
                    server.close(done)
                })
            })
        })
    })
}

module.exports = { tempDir, makeBundle, sha256, startFeedServer }
