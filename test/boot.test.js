const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const overlay = require('../src/overlay')
const { tempDir } = require('./helpers/feed')

//lays out a tiny app the way it sits in the unpacked program: package.json, src/boot.js, src/index.js, plus a fake electron module
function makeApp({ bundledVersion = '2.1.0' } = {}) {
    const base = tempDir()
    const app = path.join(base, 'app')
    const log = path.join(base, 'log.txt')

    fs.mkdirSync(path.join(app, 'src'), { recursive: true })
    fs.mkdirSync(path.join(app, 'node_modules', 'electron'), { recursive: true })
    fs.copyFileSync(path.join(__dirname, '..', 'src', 'boot.js'), path.join(app, 'src', 'boot.js'))
    fs.copyFileSync(path.join(__dirname, '..', 'src', 'overlay.js'), path.join(app, 'src', 'overlay.js'))
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ version: bundledVersion }))
    fs.writeFileSync(path.join(app, 'src', 'index.js'), `require('fs').appendFileSync(${JSON.stringify(log)}, 'bundled ${bundledVersion}\\n')`)
    fs.writeFileSync(path.join(app, 'node_modules', 'electron', 'index.js'), 'module.exports = { app: { once() {} } }')

    return { base, app, log, localAppData: path.join(base, 'local'), updates: path.join(base, 'local', 'UltraYT', 'updates') }
}

function addOverlay(env, version, indexSource) {
    const dir = path.join(env.updates, version)
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }))
    fs.writeFileSync(path.join(dir, 'src', 'index.js'), indexSource)
}

const logging = (env, text) => `require('fs').appendFileSync(${JSON.stringify(env.log)}, ${JSON.stringify(text + '\n')})`

function launch(env) {
    execFileSync(process.execPath, [ path.join(env.app, 'src', 'boot.js') ], { env: { PATH: process.env.PATH, LOCALAPPDATA: env.localAppData }, stdio: 'pipe' })
    const lines = fs.existsSync(env.log) ? fs.readFileSync(env.log, 'utf-8').trim().split('\n') : []
    fs.rmSync(env.log, { force: true })
    return lines;
}

test('without downloaded versions the bundled code starts', () => {
    const env = makeApp()
    assert.deepEqual(launch(env), [ 'bundled 2.1.0' ])
})

test('a newer downloaded version starts instead of the bundled code', () => {
    const env = makeApp()
    addOverlay(env, '2.2.0', logging(env, 'downloaded 2.2.0'))

    assert.deepEqual(launch(env), [ 'downloaded 2.2.0' ])
    assert.equal(overlay.readState(env.updates).attempts['2.2.0'], 1) //counted until a page loads
})

test('downloaded versions that are not newer are ignored', () => {
    const env = makeApp()
    addOverlay(env, '2.1.0', logging(env, 'same'))
    addOverlay(env, '2.0.0', logging(env, 'older'))

    assert.deepEqual(launch(env), [ 'bundled 2.1.0' ])
})

test('a downloaded version that throws on start is dropped and the bundled code starts in the same launch', () => {
    const env = makeApp()
    addOverlay(env, '2.2.0', `${logging(env, 'downloaded 2.2.0 began')}; throw new Error('broken')`)

    assert.deepEqual(launch(env), [ 'downloaded 2.2.0 began', 'bundled 2.1.0' ])
    assert.deepEqual(overlay.readState(env.updates).bad, [ '2.2.0' ])

    //and the next launch does not try it again
    assert.deepEqual(launch(env), [ 'bundled 2.1.0' ])
})

test('a downloaded version that never loads a page is given up on after three launches', () => {
    const env = makeApp()
    addOverlay(env, '2.2.0', logging(env, 'downloaded 2.2.0'))

    for (let i = 0; i < overlay.MAX_ATTEMPTS; i++) assert.deepEqual(launch(env), [ 'downloaded 2.2.0' ]);

    assert.deepEqual(launch(env), [ 'bundled 2.1.0' ])
})

test('a downloaded version with its own node_modules resolves them from its own folder', () => {
    const env = makeApp()
    addOverlay(env, '2.2.0', `${logging(env, 'dep says ' + 'x')}; require('dep')`)
    fs.mkdirSync(path.join(env.updates, '2.2.0', 'node_modules', 'dep'), { recursive: true })
    fs.writeFileSync(path.join(env.updates, '2.2.0', 'node_modules', 'dep', 'index.js'), logging(env, 'dep loaded'))

    assert.deepEqual(launch(env), [ 'dep says x', 'dep loaded' ])
})
