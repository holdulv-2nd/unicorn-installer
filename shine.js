#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const CURRENT_VERSION = '1.0.4';
const REPFAL_BASE = 'https://repfal.betaflare.workers.dev';

// Plugin system
let plugins = [];

function loadPlugins() {
    const pluginsDir = path.join(__dirname, 'plugins');
    if (!fs.existsSync(pluginsDir)) return;
    
    try {
        const files = fs.readdirSync(pluginsDir);
        files.forEach(file => {
            if (file.endsWith('.js')) {
                try {
                    const plugin = require(path.join(pluginsDir, file));
                    plugins.push(plugin);
                    if (plugin.init) plugin.init();
                } catch (err) {
                    console.error(`⚠️  Failed to load plugin ${file}:`, err.message);
                }
            }
        });
    } catch (err) {
        console.error('Plugin loading error:', err.message);
    }
}

function runUnicorn(code) {
    try {
        code = code
            // Basic output
            .replace(/twinkle\s+"([^"]+)";/g, 'console.log("✨ $1 ✨");')
            
            // Variables
            .replace(/fairy\s+(\w+)\s*=\s*([^;]+);/g, 'const $1 = $2;')
            .replace(/magic\s+(\w+)\s*=\s*([^;]+);/g, 'let $1 = $2;')
            .replace(/unicorn\s+(\w+)\s*=\s*"([^"]*)";/g, 'let $1 = "$2";')
            .replace(/dragon\s+(\w+)\s*=\s*([^;]+);/g, 'let $1 = $2;')
            .replace(/pixie\s+(\w+)\s*=\s*(yes|no);/g, 'let $1 = $2 === "yes";')
            .replace(/pixieDust\s+(\w+)\s*=\s*\[([^\]]*)\];/g, 'let $1 = [$2];')
            
            // Control structures
            .replace(/if\s*\(([^)]+)\)\s*{([^}]+)}(?:\s*unless\s*{([^}]+)})?/gs, (match, cond, ifBlock, elseBlock) => {
                let result = `if (${cond}) {${ifBlock}}`;
                if (elseBlock) result += ` else {${elseBlock}}`;
                return result;
            })
            
            // Functions
            .replace(/rainbow\s+(\w+)\(([^)]*)\)\s*{([^}]*)}/gs, 'function $1($2) {$3}')
            
            // Classes
            .replace(/sparkle\s+(\w+)\s*{([^}]*)}/gs, (match, name, body) => {
                const constructor = body.match(/rainbow init\(([^)]*)\)\s*{([^}]*)}/s);
                const methods = body.replace(/rainbow init\([^)]*\)\s*{[^}]*}/s, '');
                if (constructor) {
                    return `class ${name} { constructor(${constructor[1]}) {${constructor[2]}} ${methods.replace(/rainbow/g, '')} }`;
                }
                return `class ${name} { ${methods.replace(/rainbow/g, '')} }`;
            })
            
            // Error handling
            .replace(/try\s*{([^}]*)}\s*catch\s*\((\w+)\)\s*{([^}]*)}/gs, 'try {$1} catch($2) {$3}')
            .replace(/try\s*{([^}]*)}\s*catch\s*\((\w+)\)\s*{([^}]*)}\s*finally\s*{([^}]*)}/gs, 'try {$1} catch($2) {$3} finally {$4}');
        
        eval(code);
    } catch (err) {
        console.error("🦄 UnicornLang Error:", err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

function executeWithPlugin(filePath, code) {
    const ext = path.extname(filePath);
    
    for (const plugin of plugins) {
        if (plugin.extensions && plugin.extensions.includes(ext)) {
            if (plugin.execute) {
                console.log(`✨ Using plugin: ${plugin.name}`);
                return plugin.execute(filePath, code);
            }
        }
    }
    
    return false;
}

// ================= UPDATE FUNCTIONS ================= //

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
                    reject(new Error('Failed to parse update info'));
                }
            });
        }).on('error', err => reject(err));
    });
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                // Handle redirect
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            
            const total = parseInt(res.headers['content-length'], 10);
            let downloaded = 0;

            const file = fs.createWriteStream(dest);
            
            res.on('data', chunk => {
                file.write(chunk);
                downloaded += chunk.length;

                if (total) {
                    const percent = Math.floor((downloaded / total) * 20);
                    const bar = '✨'.repeat(percent) + '-'.repeat(20 - percent);
                    process.stdout.write(`\r[${bar}] ${Math.floor((downloaded / total) * 100)}%`);
                }
            });

            res.on('end', () => {
                file.close();
                console.log('\n🌟 Download complete! 🌟');
                resolve();
            });

            res.on('error', err => {
                file.close();
                fs.unlinkSync(dest);
                reject(err);
            });
        }).on('error', err => reject(err));
    });
}

async function shineUpdate() {
    try {
        console.log('🔍 Checking for updates...');
        const latest = await checkUpdate();
        
        if (latest.version === CURRENT_VERSION) {
            console.log('🦄 You are already on the latest version!');
            return;
        }

        console.log(`🌈 New version detected: ${latest.version} (current: ${CURRENT_VERSION})`);
        
        const platform = process.platform === 'win32' ? 'win-x64' :
                         process.platform === 'darwin' ? 'mac-arm64' :
                         'linux-x64';
        
        const fileUrl = latest.files[platform];
        if (!fileUrl) {
            console.error('❌ No update available for your platform.');
            return;
        }

        const fileName = `Shine.Unicorn.Installer.Setup.${latest.version}${path.extname(fileUrl)}`;
        const destPath = path.join(process.cwd(), fileName);

        // Clean up old installers
        try {
            const files = fs.readdirSync(process.cwd());
            files.forEach(file => {
                if (file.startsWith('Shine.Unicorn.Installer.Setup.') && file !== fileName) {
                    try {
                        fs.unlinkSync(path.join(process.cwd(), file));
                        console.log(`🧹 Removed old installer: ${file}`);
                    } catch (e) {
                        // Ignore if file is in use
                    }
                }
            });
        } catch (err) {
            console.warn('⚠️  Could not clean old installers:', err.message);
        }

        console.log(`✨ Downloading ${fileName}...`);
        await downloadFile(`${REPFAL_BASE}${fileUrl}`, destPath);

        console.log('🦄 Update downloaded successfully!');
        console.log(`📦 File: ${destPath}`);
        console.log('\n💡 To auto-update to this location, run:');
        console.log(`   ${destPath} -hide`);

    } catch (err) {
        console.error('❌ Update failed:', err.message);
        process.exit(1);
    }
}

// ================= MAIN FUNCTION ================= //

function showHelp() {
    console.log(`
🦄 Shine - UnicornLang Runner v${CURRENT_VERSION}

Usage:
  shine <file.unicorn>     Run a UnicornLang file
  shine update             Check and download updates
  shine help               Show this help message
  shine plugins            List loaded plugins

Examples:
  shine myprogram.unicorn
  shine update
    `);
}

function listPlugins() {
    loadPlugins();
    if (plugins.length === 0) {
        console.log('No plugins loaded.');
        return;
    }
    
    console.log('📦 Loaded Plugins:');
    plugins.forEach(plugin => {
        console.log(`  ✨ ${plugin.name || 'Unnamed'} v${plugin.version || 'unknown'}`);
        if (plugin.extensions) {
            console.log(`     Supports: ${plugin.extensions.join(', ')}`);
        }
    });
}

function main() {
    const arg = process.argv[2];

    if (!arg || arg === 'help' || arg === '--help' || arg === '-h') {
        showHelp();
        return;
    }

    if (arg === 'update') {
        shineUpdate();
        return;
    }
    
    if (arg === 'plugins') {
        listPlugins();
        return;
    }

    const file = arg;
    if (!fs.existsSync(file)) {
        console.error(`❌ File not found: ${file}`);
        process.exit(1);
    }

    loadPlugins();

    try {
        const code = fs.readFileSync(path.resolve(file), 'utf-8');
        
        // Try plugin execution first
        if (!executeWithPlugin(file, code)) {
            // Fall back to UnicornLang
            if (path.extname(file) === '.unicorn') {
                runUnicorn(code);
            } else {
                console.error(`❌ Unsupported file type: ${path.extname(file)}`);
                console.log('💡 Install a plugin or use .unicorn files');
                process.exit(1);
            }
        }
    } catch (err) {
        console.error('❌ Execution error:', err.message);
        process.exit(1);
    }
}

main();