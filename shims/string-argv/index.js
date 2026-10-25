//minimal replacement for the string-argv package (same parsing rules as string-argv 0.3.2)
function firstString() {
    for (const value of arguments) {
        if (typeof value === 'string') return value;
    }
}

function parseArgsStringToArgv(value, env, file) {
    const pattern = /([^\s'"]([^\s'"]*(['"])([^]*?)\3)+[^\s'"]*)|[^\s'"]+|(['"])([^]*?)\5/gi
    const result = []
    if (env) result.push(env)
    if (file) result.push(file)

    let match;
    while ((match = pattern.exec(value)) !== null) {
        result.push(firstString(match[1], match[6], match[0]))
    }

    return result;
}

module.exports = parseArgsStringToArgv
module.exports.default = parseArgsStringToArgv
module.exports.parseArgsStringToArgv = parseArgsStringToArgv
