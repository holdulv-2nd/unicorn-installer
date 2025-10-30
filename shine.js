#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const CURRENT_VERSION = '1.0.7';
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
        let jsCode = code;
        
        // Basic output - handle both quoted strings and variables
        jsCode = jsCode.replace(/twinkle\s+([^;]+);/g, 'console.log("✨ " + $1 + " ✨");');
        
        // Variables - handle different types
        jsCode = jsCode.replace(/fairy\s+(\w+)\s*=\s*([^;]+);/g, 'const $1 = $2;');
        jsCode = jsCode.replace(/magic\s+(\w+)\s*=\s*([^;]+);/g, 'let $1 = $2;');
        jsCode = jsCode.replace(/unicorn\s+(\w+)\s*=\s*"([^"]*)";/g, 'let $1 = "$2";');
        jsCode = jsCode.replace(/dragon\s+(\w+)\s*=\s*([^;]+);/g, 'let $1 = $2;');
        jsCode = jsCode.replace(/pixie\s+(\w+)\s*=\s*(yes|no);/g, 'let $1 = $2 === "yes";');
        jsCode = jsCode.replace(/pixieDust\s+(\w+)\s*=\s*\[([^\]]*)\];/g, 'let $1 = [$2];');
        
        // Functions
        jsCode = jsCode.replace(/rainbow\s+(\w+)\s*\(([^)]*)\)\s*\{/g, 'function $1($2) {');
        
        // Classes - simplified approach
        jsCode = jsCode.replace(/sparkle\s+(\w+)\s*\{/g, 'class $1 {');
        jsCode = jsCode.replace(/rainbow\s+init\s*\(([^)]*)\)\s*\{/g, 'constructor($1) {');
        
        // FIXED: Handle if-unless pattern properly
        // First, handle if-unless together as a single pattern
        jsCode = jsCode.replace(/if\s*\(([^)]+)\)\s*\{([^}]*)\}\s*unless\s*\{([^}]*)\}/g, 
            'if ($1) {$2} else {$3}');
        
        // Then handle standalone if statements
        jsCode = jsCode.replace(/if\s*\(([^)]+)\)\s*\{/g, 'if ($1) {');
        
        // Handle standalone unless as else
        jsCode = jsCode.replace(/unless\s*\{/g, 'else {');
        
        // Error handling
        jsCode = jsCode.replace(/try\s*\{([^}]*)\}\s*catch\s*\(([^)]+)\)\s*\{([^}]*)\}/g, 
            'try {$1} catch($2) {$3}');
        
        // Simple loops
        jsCode = jsCode.replace(/repeat\s+(\d+)\s+times\s*\{/g, 'for (let i = 0; i < $1; i++) {');
        
        // Equality check - use 'is' instead of 'is' to avoid conflicts
        jsCode = jsCode.replace(/\bis\b/g, '===');
        
        console.log('🔧 Transpiled Code:', jsCode);
        
        eval(jsCode);
    } catch (err) {
        console.error("🦄 UnicornLang Error:", err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

function executeWithPlugin(filePath, code) {
    const ext = path.extname(filePath).toLowerCase();
    
    for (const plugin of plugins) {
        if (plugin.extensions && plugin.extensions.some(e => e.toLowerCase() === ext)) {
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
        const request = https.get(url, res => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                console.log(`🔀 Redirecting to: ${res.headers.location}`);
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
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
                file.end();
                console.log('\n🌟 Download complete! 🌟');
                resolve();
            });

            res.on('error', err => {
                file.end();
                try { fs.unlinkSync(dest); } catch (e) {}
                reject(err);
            });
            
            file.on('error', err => {
                try { fs.unlinkSync(dest); } catch (e) {}
                reject(err);
            });
        }).on('error', err => reject(err));
        
        request.setTimeout(30000, () => {
            request.destroy();
            reject(new Error('Download timeout'));
        });
    });
}

async function shineUpdate() {
    try {
        console.log('🔍 Checking for updates...');
        const latest = await checkUpdate();
        
        const currentVersion = CURRENT_VERSION.replace(/^v/, '');
        const latestVersion = latest.version.replace(/^v/, '');
        
        if (latestVersion === currentVersion) {
            console.log('🦄 You are already on the latest version!');
            return;
        }

        console.log(`🌈 New version detected: ${latestVersion} (current: ${currentVersion})`);
        
        let platformFile;
        const platform = process.platform;
        
        if (platform === 'win32') {
            platformFile = latest.files['win-x64'] || latest.files['windows'] || latest.files['exe'];
        } else if (platform === 'darwin') {
            platformFile = latest.files['mac-arm64'] || latest.files['mac-x64'] || latest.files['dmg'];
        } else {
            platformFile = latest.files['linux-x64'] || latest.files['appimage'] || latest.files['deb'];
        }
        
        if (!platformFile) {
            console.error('❌ No update available for your platform.');
            console.log('Available files:', Object.keys(latest.files));
            return;
        }

        let fileName = `Shine.Unicorn.Installer.Setup.${latestVersion}`;
        
        if (platform === 'win32') {
            fileName += '.exe';
        } else if (platform === 'darwin') {
            fileName += '.dmg';
        } else if (platformFile.includes('.deb')) {
            fileName += '.deb';
        } else {
            fileName += '.AppImage';
        }

        const destPath = path.join(process.cwd(), fileName);

        try {
            const files = fs.readdirSync(process.cwd());
            files.forEach(file => {
                if (file.startsWith('Shine.Unicorn.Installer.Setup.') && file !== fileName) {
                    try {
                        fs.unlinkSync(path.join(process.cwd(), file));
                        console.log(`🧹 Removed old installer: ${file}`);
                    } catch (e) {}
                }
            });
        } catch (err) {
            console.warn('⚠️  Could not clean old installers:', err.message);
        }

        console.log(`✨ Downloading ${fileName}...`);
        console.log(`📥 From: ${REPFAL_BASE}${platformFile}`);
        
        await downloadFile(`${REPFAL_BASE}${platformFile}`, destPath);

        try {
            const stats = fs.statSync(destPath);
            if (stats.size === 0) {
                throw new Error('Downloaded file is empty');
            }
            console.log(`✅ File verified: ${stats.size} bytes`);
        } catch (err) {
            console.error('❌ Downloaded file is invalid:', err.message);
            try { fs.unlinkSync(destPath); } catch (e) {}
            throw err;
        }

        console.log('🦄 Update downloaded successfully!');
        console.log(`📦 File: ${destPath}`);
        
        if (platform === 'win32') {
            console.log('\n💡 To install the update:');
            console.log(`   ${destPath}`);
            console.log('\n💡 To auto-update (silent install):');
            console.log(`   "${destPath}" -hide`);
        } else {
            console.log('\n💡 To install the update:');
            console.log(`   chmod +x "${destPath}" && "${destPath}"`);
        }

    } catch (err) {
        console.error('❌ Update failed:', err.message);
        console.log('💡 You may need to update manually contact support');
        process.exit(1);
    }
}

// ================= MAIN FUNCTION ================= //

function showHelp() {
    console.log(`
🦄 Shine - UnicornLang Runner v${CURRENT_VERSION}

Usage:
  shine <file.unicorn>     Run a UnicornLang file
  shine <file.js>          Run a JavaScript file (if plugin loaded)
  shine <file.cpp>         Compile and run C++ file (if plugin loaded)
  shine update             Check and download updates
  shine help               Show this help message
  shine plugins            List loaded plugins

Examples:
  shine myprogram.unicorn
  shine hello.js
  shine test.cpp
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
        const pluginUsed = executeWithPlugin(file, code);
        if (pluginUsed !== false) {
            return;
        }
        
        // Fall back to UnicornLang for .unicorn files
        if (path.extname(file).toLowerCase() === '.unicorn') {
            runUnicorn(code);
        } else {
            console.error(`❌ Unsupported file type: ${path.extname(file)}`);
            console.log('💡 Install a plugin or use .unicorn files');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Execution error:', err.message);
        process.exit(1);
    }
}

main();