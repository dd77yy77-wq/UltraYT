const assert = require('node:assert/strict')
const test = require('node:test')
const package = require('../package.json')
const { startFeedServer, makeBundle, tempDir } = require('./helpers/feed')
const { detectInstallation } = require('../src/updater')

test('development builds are reported as development', () => {
    assert.deepEqual(detectInstallation({ isPackaged: false }), { type: 'development' })
})

test('macOS applications are reported as applications', () => {
    assert.deepEqual(detectInstallation({ platform: 'darwin', isPackaged: true }), { type: 'application' })
})

test('Windows tells an installed copy from a portable one', () => {
    const exePath = 'C:\\Users\\Test\\UltraYT\\UltraYT.exe'

    assert.deepEqual(detectInstallation({
        platform: 'win32',
        exePath,
        isPackaged: true,
        existsSync: (candidate) => candidate === 'C:\\Users\\Test\\UltraYT\\Uninstall UltraYT.exe'
    }), { type: 'installer' })

    assert.deepEqual(detectInstallation({
        platform: 'win32',
        exePath,
        isPackaged: true,
        existsSync: () => false
    }), { type: 'portable' })
})

test('Linux recognizes Flatpak and AppImage packaging without guessing package managers', () => {
    assert.deepEqual(detectInstallation({
        platform: 'linux',
        isPackaged: true,
        env: { FLATPAK_ID: 'ultrayt.app' },
        existsSync: () => false
    }), { type: 'flatpak' })

    assert.deepEqual(detectInstallation({
        platform: 'linux',
        isPackaged: true,
        env: { APPIMAGE: '/tmp/UltraYT.AppImage' },
        existsSync: () => false
    }), { type: 'appimage' })

    assert.deepEqual(detectInstallation({
        platform: 'linux',
        isPackaged: true,
        env: {},
        existsSync: () => false
    }), { type: 'package' })
})

function fakeElectron(calls) {
    const handlers = new Map()

    return {
        handlers,
        electron: {
            app: {
                isPackaged: true,
                getPath: () => 'C:\\Users\\Test\\AppData\\Local\\UltraYT\\app\\UltraYT.exe',
                relaunch: () => calls.push('relaunch'),
                quit: () => calls.push('quit')
            },
            ipcMain: {
                handle: (name, handler) => handlers.set(name, handler)
            }
        }
    }
}

test('setup exposes about info, update check and install handlers', async () => {
    const modulePath = require.resolve('../src/updater')
    delete require.cache[modulePath]

    const updater = require(modulePath)
    const calls = []
    const { electron, handlers } = fakeElectron(calls)

    updater.setup({ platform: 'win32', env: {}, electron, isAutoUpdateEnabled: () => false })

    assert.deepEqual([ ...handlers.keys() ], [ 'get-about-info', 'check-for-updates', 'install-update' ])

    const info = await handlers.get('get-about-info')()
    assert.equal(info.currentVersion, package.version)
    assert.equal(info.installationType, 'portable')
    assert.equal(info.status, 'idle')

    //nothing is ready, so installing does nothing
    assert.equal(await handlers.get('install-update')(), false)
    assert.deepEqual(calls, [])
})

test('a newer version in the feed is downloaded, announced to the window and installed by restarting', async () => {
    const modulePath = require.resolve('../src/updater')
    delete require.cache[modulePath]

    const updater = require(modulePath)
    const calls = []
    const sent = []
    const { electron, handlers } = fakeElectron(calls)
    const updatesDir = tempDir()
    const server = await startFeedServer({ version: '9.9.9', bundle: makeBundle('9.9.9') })

    try {
        updater.setup({
            platform: 'win32',
            env: {},
            electron,
            feedUrl: server.feedUrl,
            updatesDir,
            allowInsecure: true,
            isAutoUpdateEnabled: () => false,
            getWindow: () => ({ isDestroyed: () => false, webContents: { send: (name, state) => sent.push([ name, state.status ]) } })
        })

        const result = await handlers.get('check-for-updates')()
        assert.equal(result.status, 'ready')
        assert.equal(result.latestVersion, '9.9.9')
        assert.deepEqual(sent, [ [ 'update-state-changed', 'checking' ], [ 'update-state-changed', 'ready' ] ])

        assert.equal(await handlers.get('install-update')(), true)
        assert.deepEqual(calls, [ 'relaunch', 'quit' ])
    } finally {
        await server.close()
    }
})

test('a failed check ends in the error state instead of throwing', async () => {
    const modulePath = require.resolve('../src/updater')
    delete require.cache[modulePath]

    const updater = require(modulePath)
    const { electron, handlers } = fakeElectron([])
    const server = await startFeedServer({ version: '9.9.9', bundle: makeBundle('9.9.9'), corruptBundle: true })

    try {
        updater.setup({
            platform: 'win32',
            env: {},
            electron,
            feedUrl: server.feedUrl,
            updatesDir: tempDir(),
            allowInsecure: true,
            isAutoUpdateEnabled: () => false
        })

        const originalError = console.error
        console.error = () => {}
        let result;
        try {
            result = await handlers.get('check-for-updates')()
        } finally {
            console.error = originalError
        }

        assert.equal(result.status, 'error')
    } finally {
        await server.close()
    }
})
