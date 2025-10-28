#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function runUnicorn(code) {
    try {
        code = code
            .replace(/twinkle\s+"([^"]+)";/g, 'console.log("✨ $1 ✨");')
            .replace(/fairy\s+(\w+)\s*=\s*([^;]+);/g, 'const $1 = $2;')
            .replace(/magic\s+(\w+)\s*=\s*([^;]+);/g, 'let $1 = $2;')
            .replace(/unicorn\s+(\w+)\s*=\s*"([^"]*)";/g, 'let $1 = "$2";')
            .replace(/dragon\s+(\w+)\s*=\s*([^;]+);/g, 'let $1 = $2;')
            .replace(/pixie\s+(\w+)\s*=\s*(yes|no);/g, 'let $1 = $2 === "yes";')
            .replace(/pixieDust\s+(\w+)\s*=\s*\[([^\]]*)\];/g, 'let $1 = [$2];')
            .replace(/if\s*\(([^)]+)\)\s*{([^}]+)}(?:\s*unless\s*{([^}]+)})?/gs, (match, cond, ifBlock, elseBlock) => {
                let result = `if (${cond}) {${ifBlock}}`;
                if (elseBlock) result += ` else {${elseBlock}}`;
                return result;
            })
            .replace(/rainbow\s+(\w+)\(([^)]*)\)\s*{([^}]*)}/gs, 'function $1($2) {$3}')
            .replace(/sparkle\s+(\w+)\s*{([^}]*)}/gs, (match, name, body) => {
                const constructor = body.match(/rainbow init\(([^)]*)\)\s*{([^}]*)}/s);
                const methods = body.replace(/rainbow init\([^)]*\)\s*{[^}]*}/s, '');
                let classDef = `class ${name} { constructor(${constructor[1]}) {${constructor[2]}} ${methods.replace(/rainbow/g, '')} }`;
                return classDef;
            })
            .replace(/new\s+(\w+)\(([^)]+)\);/g, 'new $1($2)')
            .replace(/try\s*{([^}]*)}\s*catch\s*\((\w+)\)\s*{([^}]*)}\s*finally\s*{([^}]*)}/gs, 'try {$1} catch($2) {$3} finally {$4}');
        
        eval(code);
    } catch (err) {
        console.error("UnicornLang Error:", err.message);
    }
}

function main() {
    const file = process.argv[2];
    if (!file) {
        console.log("🦄 Usage: shine <file.unicorn>");
        process.exit(1);
    }
    const code = fs.readFileSync(path.resolve(file), 'utf-8');
    runUnicorn(code);
}

main();
