const assert = require('node:assert/strict')
const test = require('node:test')
const package = require('../package.json')
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

test('setup only exposes installation info and registers no update or link handlers', async () => {
    const modulePath = require.resolve('../src/updater')
    delete require.cache[modulePath]

    const updater = require(modulePath)
    const handlers = new Map()
    const listeners = new Map()

    updater.setup({
        platform: 'win32',
        env: {},
        electron: {
            app: {
                isPackaged: true,
                getPath: () => 'C:\\Users\\Test\\AppData\\Local\\UltraYT\\app\\UltraYT.exe',
                getVersion: () => package.version
            },
            ipcMain: {
                handle: (name, handler) => handlers.set(name, handler),
                on: (name, listener) => listeners.set(name, listener)
            }
        }
    })

    assert.deepEqual([ ...handlers.keys() ], [ 'get-about-info' ])
    assert.equal(listeners.size, 0)

    const info = await handlers.get('get-about-info')()
    assert.equal(info.currentVersion, package.version)
    assert.equal(info.installationType, 'portable')
})
