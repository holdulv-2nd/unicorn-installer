#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

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

// ================= UPDATE FUNCTIONS ================= //

const REPFAL_BASE = 'https://repfal.betaflare.workers.dev';
const CURRENT_VERSION = '1.0.0';

function checkUpdate() {
    return new Promise((resolve, reject) => {
        https.get(`${REPFAL_BASE}/latest.json`, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', err => reject(err));
    });
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            const total = parseInt(res.headers['content-length'], 10);
            let downloaded = 0;

            const file = fs.createWriteStream(dest);
            res.on('data', chunk => {
                file.write(chunk);
                downloaded += chunk.length;

                const percent = Math.floor((downloaded / total) * 20);
                const bar = '✨'.repeat(percent) + '-'.repeat(20 - percent);
                process.stdout.write(`\r[${bar}] ${Math.floor((downloaded / total) * 100)}%`);
            });

            res.on('end', () => {
                file.close();
                console.log('\n🌟 Download complete! 🌟');
                resolve();
            });

            res.on('error', err => {
                file.close();
                reject(err);
            });
        });
    });
}

async function shineUpdate() {
    try {
        const latest = await checkUpdate();
        if (latest.version === CURRENT_VERSION) {
            console.log('🦄 You are already on the latest version!');
            return;
        }

        console.log(`🌈 New version detected: ${latest.version}`);
        const platform = process.platform === 'win32' ? 'win-x64' :
                         process.platform === 'darwin' ? 'mac-arm64' :
                         'linux-x64';
        const fileUrl = latest.files[platform];
        if (!fileUrl) {
            console.error('❌ No update available for your platform.');
            return;
        }

        const fileName = path.basename(fileUrl);
        const destPath = path.join(process.cwd(), fileName);

        // Remove any old installer for same platform
        fs.readdirSync(process.cwd()).forEach(file => {
            if (file.includes('Shine.Unicorn.Installer') && file !== fileName) {
                fs.unlinkSync(path.join(process.cwd(), file));
                console.log(`🧹 Removed old installer: ${file}`);
            }
        });

        console.log(`✨ Downloading ${fileName} ...`);
        await downloadFile(`${REPFAL_BASE}${fileUrl}`, destPath);

        console.log('🦄 Update ready! You can now run the new installer.');

    } catch (err) {
        console.error('❌ Update failed:', err.message);
    }
}

// ================= MAIN FUNCTION ================= //

function main() {
    const arg = process.argv[2];

    if (arg === 'update') {
        shineUpdate();
        return;
    }

    const file = arg;
    if (!file) {
        console.log("🦄 Usage: shine <file.unicorn> or shine update");
        process.exit(1);
    }

    const code = fs.readFileSync(path.resolve(file), 'utf-8');
    runUnicorn(code);
}

main();
