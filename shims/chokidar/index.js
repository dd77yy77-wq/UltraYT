//minimal replacement for chokidar, enough for the userstyles folder watcher (non-recursive, add/change/unlink/ready/error)
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

class Watcher extends EventEmitter {
    constructor(dir) {
        super()
        this.dir = dir;
        this.known = new Set()
        this.timers = new Map()
        this.closed = false;

        try {
            for (const name of fs.readdirSync(dir)) this.known.add(name)

            this.fsWatcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
                if (!filename || this.closed) return;
                this.schedule(String(filename))
            })

            this.fsWatcher.on('error', (err) => this.emit('error', err))
        } catch (err) {
            setImmediate(() => this.emit('error', err))
        }

        setImmediate(() => this.emit('ready'))
    }

    //fs.watch fires several times per save, so settle for a moment before looking at the file
    schedule(name) {
        clearTimeout(this.timers.get(name))
        this.timers.set(name, setTimeout(() => {
            this.timers.delete(name)
            this.check(name)
        }, 50))
    }

    check(name) {
        if (this.closed) return;

        const file = path.join(this.dir, name)
        const exists = fs.existsSync(file)

        if (exists && !this.known.has(name)) {
            this.known.add(name)
            this.emit('add', file)
        } else if (exists) {
            this.emit('change', file)
        } else if (this.known.has(name)) {
            this.known.delete(name)
            this.emit('unlink', file)
        }
    }

    close() {
        this.closed = true;
        for (const timer of this.timers.values()) clearTimeout(timer)
        this.timers.clear()
        this.fsWatcher?.close()
        return Promise.resolve();
    }
}

function watch(dir) {
    return new Watcher(dir);
}

module.exports = { watch }
