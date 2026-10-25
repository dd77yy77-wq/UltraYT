const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { collectFiles, buildBundle } = require('../tools/make-update')
const { stageUpdate } = require('../src/self-update')
const overlay = require('../src/overlay')
const { tempDir, startFeedServer } = require('./helpers/feed')

test('the real app is turned into a bundle that the updater accepts and the launcher can start', async () => {
    const collected = collectFiles()
    const bundle = buildBundle(collected)
    const updatesDir = tempDir()

    //pretend the bundled copy is older than the repository state
    const server = await startFeedServer({ version: collected.version, bundle })

    try {
        const result = await stageUpdate({ feedUrl: server.feedUrl, currentVersion: '0.0.1', updatesDir, allowInsecure: true })
        assert.deepEqual(result, { status: 'ready', latestVersion: collected.version })
    } finally {
        await server.close()
    }

    const dir = path.join(updatesDir, collected.version)

    for (const rel of [ 'package.json', 'src/boot.js', 'src/index.js', 'src/self-update.js', 'src/overlay.js', 'locale/en.json', 'assets/icon.png', 'node_modules/chokidar/index.js', 'node_modules/string-argv/index.js' ]) {
        assert.ok(fs.existsSync(path.join(dir, ...rel.split('/'))), rel)
    }

    //every file is identical to the one in the repository
    for (const [ rel, data ] of Object.entries(collected.files)) {
        assert.ok(fs.readFileSync(path.join(dir, ...rel.split('/'))).equals(data), rel)
    }

    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).main, 'src/boot.js')
    assert.equal(overlay.chooseOverlay({ root: updatesDir, bundledVersion: '0.0.1' }).version, collected.version)
})

test('the bundle is the same every time it is built from the same files', () => {
    const collected = collectFiles()
    assert.ok(buildBundle(collected).equals(buildBundle(collected)))
})

test('the shipped feed matches the bundle in updates/', () => {
    const root = path.join(__dirname, '..')
    const feedFile = path.join(root, 'version.json')
    if (!fs.existsSync(feedFile)) return; //not built yet

    const feed = JSON.parse(fs.readFileSync(feedFile, 'utf-8'))
    const bundle = fs.readFileSync(path.join(root, feed.url))

    assert.equal(feed.version, require('../package.json').version)
    assert.equal(feed.size, bundle.length)
    assert.equal(feed.sha256, require('node:crypto').createHash('sha256').update(bundle).digest('hex'))
})

test('every module required by the app code is in the bundle, bundled with it or built into Electron', () => {
    const { builtinModules } = require('node:module')
    const { files } = collectFiles()
    const names = new Set(Object.keys(files))
    const missing = []

    for (const [ rel, data ] of Object.entries(files)) {
        if (!rel.startsWith('src/') || !rel.endsWith('.js')) continue;

        for (const match of data.toString('utf-8').matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)) {
            const request = match[2]

            if (request.startsWith('.')) {
                const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
                const found = [ target, `${target}.js`, `${target}.json`, `${target}/index.js` ].some((candidate) => names.has(candidate))
                if (!found) missing.push(`${rel} -> ${request}`)
            } else if (request !== 'electron' && !request.startsWith('node:') && !builtinModules.includes(request)) {
                const found = [ `node_modules/${request}/index.js`, `node_modules/${request}.js` ].some((candidate) => names.has(candidate))
                if (!found) missing.push(`${rel} -> ${request}`)
            }
        }
    }

    assert.deepEqual(missing, [])
})
