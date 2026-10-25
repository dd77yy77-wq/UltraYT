//about page, opened from the header's "?" button
//shows the version and how this copy is installed (info comes from the main process, see src/updater.js)

const fs = require('fs')
const path = require('path')
const { ipcRenderer } = require('electron')

const iconPath = path.join(__dirname, '../../../../../assets/icon.png') //good lord
const iconDataUrl = `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`

let state = {
    currentVersion: '',
    platform: process.platform,
    arch: process.arch,
    installationType: 'unknown'
}

function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
}

function platformLabel(about) {
    const platform = about.platforms[state.platform] || state.platform;
    return `${platform} · ${about.architectures[state.arch] || state.arch}`;
}

module.exports = {
    id: 'about',

    icon: iconDataUrl,
    title: 'UltraYT',
    crumb: (locale) => locale.about.title,
    description: (locale) => locale.about.description,
    badge: (locale) => state.currentVersion && fill(locale.about.version, { version: state.currentVersion }),

    async onOpen() {
        try {
            state = await ipcRenderer.invoke('get-about-info')
        } catch (err) {
            console.error('[About] Failed to load application information:', err)
        }
    },

    sections: (config, locale) => {
        const about = locale.about;

        return [
            {
                rows: [
                    { type: 'info', title: about.platform_label, value: platformLabel(about) },
                    { type: 'info', title: about.installation_label, value: about.installations[state.installationType] || about.installations.unknown }
                ]
            }
        ];
    }
}
