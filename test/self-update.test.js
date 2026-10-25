const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { isSafePath, stageUpdate, prune } = require('../src/self-update')
const overlay = require('../src/overlay')
const { tempDir, makeBundle, sha256, startFeedServer } = require('./helpers/feed')

async function withServer(options, run) {
    const server = await startFeedServer(options)
    try {
        return await run(server)
    } finally {
        await server.close()
    }
}

const stage = (server, updatesDir, currentVersion = '2.1.0', extra = {}) => stageUpdate({
    feedUrl: server.feedUrl,
    currentVersion,
    updatesDir,
    allowInsecure: true,
    ...extra
})

test('only files of the app itself may be written by an update', () => {
    for (const ok of [ 'package.json', 'src/index.js', 'src/preload/modules/a.js', 'locale/en.json', 'assets/icons/16x16.png', 'node_modules/@scope/pkg/index.js', 'node_modules/string-argv/index.js' ]) {
        assert.equal(isSafePath(ok), true, ok)
    }

    for (const bad of [ '../evil.js', 'src/../../evil.js', '/etc/passwd', 'C:/Windows/x.dll', 'src\\a.js', 'UltraYT.exe', 'src', 'src/', 'src//a.js', 'src/.hidden', 'other/a.js', 'package.json/x', '', null, 5, 'src/a:b.js', 'src/..' ]) {
        assert.equal(isSafePath(bad), false, String(bad))
    }
})

test('a feed with the same or an older version changes nothing', async () => {
    const updatesDir = tempDir()

    await withServer({ version: '2.1.0', bundle: makeBundle('2.1.0') }, async (server) => {
        assert.deepEqual(await stage(server, updatesDir, '2.1.0'), { status: 'current', latestVersion: '2.1.0' })
        assert.deepEqual(await stage(server, updatesDir, '2.2.0'), { status: 'current', latestVersion: '2.1.0' })
    })

    assert.deepEqual(fs.readdirSync(updatesDir), [])
})

test('a newer version is stored and then picked by the launcher', async () => {
    const updatesDir = tempDir()

    await withServer({ version: '2.2.0', bundle: makeBundle('2.2.0', { 'node_modules/dep/index.js': 'module.exports = 1', 'locale/en.json': '{}' }) }, async (server) => {
        assert.deepEqual(await stage(server, updatesDir), { status: 'ready', latestVersion: '2.2.0' })

        //asking again does not download again
        assert.deepEqual(await stage(server, updatesDir), { status: 'ready', latestVersion: '2.2.0' })
    })

    const dir = path.join(updatesDir, '2.2.0')
    assert.equal(require(path.join(dir, 'src', 'index.js')), '2.2.0')
    assert.equal(fs.readFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'utf-8'), 'module.exports = 1')
    assert.deepEqual(fs.readdirSync(updatesDir), [ '2.2.0' ])

    const chosen = overlay.chooseOverlay({ root: updatesDir, bundledVersion: '2.1.0' })
    assert.equal(chosen.version, '2.2.0')
    assert.equal(chosen.dir, dir)

    //the bundled code is used when it is the same or newer
    assert.equal(overlay.chooseOverlay({ root: updatesDir, bundledVersion: '2.2.0' }), null)
})

test('a bundle that does not match its checksum is rejected and nothing is stored', async () => {
    const updatesDir = tempDir()
    const bundle = makeBundle('2.2.0')

    await withServer({ version: '2.2.0', bundle, sha256: sha256(Buffer.from('something else')) }, async (server) => {
        await assert.rejects(stage(server, updatesDir), /checksum/)
    })

    await withServer({ version: '2.2.0', bundle, corruptBundle: true }, async (server) => {
        await assert.rejects(stage(server, updatesDir), /checksum/)
    })

    assert.deepEqual(fs.existsSync(updatesDir) ? fs.readdirSync(updatesDir) : [], [])
})

test('bundles with paths outside the app folder are rejected', async () => {
    for (const evil of [ '../evil.js', 'src/../../evil.js', '/tmp/evil.js', 'UltraYT.exe', 'src/a\\..\\b.js' ]) {
        const updatesDir = tempDir()
        const bundle = makeBundle('2.2.0', { [evil]: 'boom' })

        await withServer({ version: '2.2.0', bundle }, async (server) => {
            await assert.rejects(stage(server, updatesDir), /unexpected file/, evil)
        })

        assert.deepEqual(fs.existsSync(updatesDir) ? fs.readdirSync(updatesDir) : [], [], evil)
        assert.equal(fs.existsSync(path.join(updatesDir, '..', 'evil.js')), false, evil)
    }
})

test('bundles that are incomplete or for another version are rejected', async () => {
    for (const [ name, bundle, pattern ] of [
        [ 'no entry point', makeBundle('2.2.0', { 'src/index.js': null }), /src\/index\.js/ ],
        [ 'no package.json', makeBundle('2.2.0', { 'package.json': null }), /package\.json/ ],
        [ 'package.json for another version', makeBundle('2.2.0', { 'package.json': JSON.stringify({ version: '1.0.0' }) }), /package\.json/ ],
        [ 'bundle for another version', makeBundle('2.3.0'), /does not match the feed/ ]
    ]) {
        const updatesDir = tempDir()

        await withServer({ version: '2.2.0', bundle }, async (server) => {
            await assert.rejects(stage(server, updatesDir), pattern, name)
        })

        assert.deepEqual(fs.existsSync(updatesDir) ? fs.readdirSync(updatesDir) : [], [], name)
    }
})

test('the bundle has to be on the same host as the feed', async () => {
    const bundle = makeBundle('2.2.0')

    await withServer({ version: '2.2.0', bundle, url: 'http://localhost:1/updates/app.json.gz' }, async (server) => {
        await assert.rejects(stage(server, tempDir()), /different host/)
    })
})

test('the feed has to use https unless tests allow otherwise', async () => {
    await withServer({ version: '2.2.0', bundle: makeBundle('2.2.0') }, async (server) => {
        await assert.rejects(stageUpdate({ feedUrl: server.feedUrl, currentVersion: '2.1.0', updatesDir: tempDir() }), /https/)
    })
})

test('a broken feed is an error', async () => {
    const updatesDir = tempDir()

    await withServer({ version: 'not-a-version', bundle: makeBundle('2.2.0') }, async (server) => {
        await assert.rejects(stage(server, updatesDir), /valid version/)
    })

    await withServer({ version: '2.2.0', bundle: makeBundle('2.2.0'), sha256: 'zz' }, async (server) => {
        await assert.rejects(stage(server, updatesDir), /checksum/)
    })

    await withServer({ version: '2.2.0', bundle: makeBundle('2.2.0'), url: '' }, async (server) => {
        await assert.rejects(stage(server, updatesDir), /bundle url/)
    })
})

test('a version that failed to start is not offered again', async () => {
    const updatesDir = tempDir()

    await withServer({ version: '2.2.0', bundle: makeBundle('2.2.0') }, async (server) => {
        assert.equal((await stage(server, updatesDir)).status, 'ready')

        overlay.markBad(updatesDir, '2.2.0')
        assert.equal((await stage(server, updatesDir)).status, 'current')
    })

    //and a newer one still comes through
    await withServer({ version: '2.2.1', bundle: makeBundle('2.2.1') }, async (server) => {
        assert.equal((await stage(server, updatesDir)).status, 'ready')
    })

    assert.equal(overlay.chooseOverlay({ root: updatesDir, bundledVersion: '2.1.0' }).version, '2.2.1')
})

test('only the two newest downloaded versions and no leftovers are kept', async () => {
    const updatesDir = tempDir()

    for (const version of [ '2.2.0', '2.3.0', '2.10.0', '2.4.0' ]) {
        await withServer({ version, bundle: makeBundle(version) }, (server) => stage(server, updatesDir))
    }

    fs.mkdirSync(path.join(updatesDir, '2.9.9.tmp-123'))
    prune(updatesDir)

    assert.deepEqual(fs.readdirSync(updatesDir).sort(), [ '2.10.0', '2.4.0' ])
})
