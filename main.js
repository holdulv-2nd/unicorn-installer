const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const platform = os.platform();
const homeDir = os.homedir();

// Load Unicorn runner
const shineCode = fs.readFileSync(path.join(__dirname, 'shine.js'), 'utf-8');

// Check if launched with -hide flag for auto-update
const hideFlag = process.argv.includes('-hide');
let autoInstallPath = null;

if (hideFlag) {
    const possiblePaths = [
        path.join(homeDir, 'Shine'),
        path.join(homeDir, '.shine'),
        path.join(homeDir, 'AppData', 'Local', 'Shine'),
        '/usr/local/bin',
        'C:\\Program Files\\Shine'
    ];
    
    for (const p of possiblePaths) {
        if (fs.existsSync(path.join(p, platform === 'win32' ? 'shine.js' : 'shine'))) {
            autoInstallPath = p;
            break;
        }
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 600,
        height: 550,
        resizable: false,
        autoHideMenuBar: true,
        webPreferences: { 
            nodeIntegration: true, 
            contextIsolation: false 
        },
        icon: path.join(__dirname, 'icon.png'),
        show: !hideFlag
    });
    
    win.loadFile('index.html');
    
    if (hideFlag && autoInstallPath) {
        setTimeout(() => {
            performInstallation(path.dirname(autoInstallPath), win);
        }, 1000);
    }
    
    return win;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// --- Helper functions ---
function isAdmin() {
    if (platform === 'win32') {
        try { 
            execSync('fsutil dirty query %systemdrive%', { stdio: 'ignore' }); 
            return true; 
        } catch { 
            return false; 
        }
    } else {
        return process.getuid && process.getuid() === 0;
    }
}

function addToPath(installPath) {
    try {
        if (platform === 'win32') {
            const currentPath = execSync('powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"', { encoding: 'utf-8' }).trim();
            if (!currentPath.includes(installPath)) {
                const newPath = currentPath ? `${currentPath};${installPath}` : installPath;
                execSync(`powershell -Command "[Environment]::SetEnvironmentVariable('Path', '${newPath.replace(/'/g, "''")}', 'User')"`);
            }
        } else if (platform === 'darwin') {
            const shells = ['.zshrc', '.bash_profile'];
            shells.forEach(shell => {
                const shellPath = path.join(homeDir, shell);
                const exportLine = `\nexport PATH="$PATH:${installPath}"\n`;
                try {
                    let content = fs.existsSync(shellPath) ? fs.readFileSync(shellPath, 'utf-8') : '';
                    if (!content.includes(installPath)) {
                        fs.appendFileSync(shellPath, exportLine);
                    }
                } catch (err) {
                    console.error(`Failed to update ${shell}:`, err);
                }
            });
        } else if (platform === 'linux') {
            const bashrc = path.join(homeDir, '.bashrc');
            const exportLine = `\nexport PATH="$PATH:${installPath}"\n`;
            try {
                let content = fs.existsSync(bashrc) ? fs.readFileSync(bashrc, 'utf-8') : '';
                if (!content.includes(installPath)) {
                    fs.appendFileSync(bashrc, exportLine);
                }
            } catch (err) {
                console.error('Failed to update .bashrc:', err);
            }
        }
    } catch (err) {
        throw new Error(`Failed to add to PATH: ${err.message}`);
    }
}

// ⭐ NEW: Bundle Node.js from Electron
function createNodeWrapper(installPath) {
    console.log('📦 Bundling Node.js runtime...');
    
    try {
        if (platform === 'win32') {
            // Windows: Copy electron.exe as node.exe
            const nodePath = path.join(installPath, 'node.exe');
            fs.copyFileSync(process.execPath, nodePath);
            console.log('✅ Node.js bundled successfully (Windows)');
        } else {
            // Unix: Create wrapper script
            const nodePath = path.join(installPath, 'node');
            const electronPath = process.execPath;
            
            // Create a wrapper that executes like node
            const wrapperScript = `#!/bin/bash
exec "${electronPath}" "$@"
`;
            fs.writeFileSync(nodePath, wrapperScript, { mode: 0o755 });
            console.log('✅ Node.js wrapper created successfully (Unix)');
        }
    } catch (err) {
        console.error('⚠️  Failed to bundle Node.js:', err.message);
        console.log('Users will need to install Node.js manually');
    }
}

function makeTerminalWrapper(runnerPath, installPath) {
    const nodePath = path.join(installPath, platform === 'win32' ? 'node.exe' : 'node');
    
    if (platform === 'win32') {
        const wrapperPath = path.join(installPath, 'shine.cmd');
        
        // Check if bundled Node.js exists, otherwise fall back to system node
        const nodeCommand = fs.existsSync(nodePath) ? `"${nodePath}"` : 'node';
        
        fs.writeFileSync(wrapperPath, `@echo off
${nodeCommand} "${runnerPath}" %*
if errorlevel 1 (
    echo.
    echo ✨ Error occurred! Press any key to close ✨
    pause >nul
)
`);
    } else {
        // Create Unix wrapper
        const wrapperPath = path.join(installPath, 'shine');
        const nodeCommand = fs.existsSync(nodePath) ? `"${nodePath}"` : 'node';
        
        fs.writeFileSync(wrapperPath, `#!/bin/bash
${nodeCommand} "${runnerPath}" "$@"
`, { mode: 0o755 });
    }
}

function associateFiles(installPath) {
    try {
        if (platform === 'win32') {
            execSync(`assoc .unicorn=UnicornFile`, { stdio: 'ignore' });
            execSync(`ftype UnicornFile="${path.join(installPath, 'shine.cmd')}" "%1"`, { stdio: 'ignore' });
            if (fs.existsSync(path.join(__dirname, 'icon.ico'))) {
                execSync(`reg add "HKCR\\UnicornFile\\DefaultIcon" /ve /t REG_SZ /d "${path.join(__dirname,'icon.ico')}" /f`, { stdio: 'ignore' });
            }
        } else if (platform === 'linux') {
            const desktopFile = path.join(homeDir, '.local', 'share', 'applications', 'unicorn.desktop');
            fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
            fs.writeFileSync(desktopFile, `[Desktop Entry]
Name=Unicorn Script
Exec=gnome-terminal -- bash -c "${path.join(installPath, 'shine')} %f; echo 'Press Enter to close'; read"
Icon=${path.join(__dirname,'icon.png')}
Type=Application
MimeType=text/x-unicorn;
`);
            try {
                execSync(`update-mime-database ~/.local/share/mime`, { stdio: 'ignore' });
            } catch (e) {}
        }
    } catch (err) {
        console.error('File association failed:', err.message);
    }
}

function createPluginsDirectory(installPath) {
    const pluginsDir = path.join(installPath, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
        
        // ========== FIXED C++ PLUGIN ==========
        const cppPlugin = `// C++ Plugin for Shine v1.0.2
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
    name: 'cpp-compiler',
    version: '1.0.2',
    description: 'Compiles and runs C++ files',
    
    init: function() {
        console.log('✨ C++ compiler plugin loaded!');
    },
    
    extensions: ['.cpp', '.cc', '.cxx', '.c'],
    
    findCompiler: function() {
        const platform = process.platform;
        
        const compilers = platform === 'win32' 
            ? ['g++', 'gcc', 'clang++', 'cl']
            : ['g++', 'gcc', 'clang++', 'c++'];
        
        const windowsPaths = [
            'C:\\\\msys64\\\\mingw64\\\\bin',
            'C:\\\\msys64\\\\ucrt64\\\\bin',
            'C:\\\\msys64\\\\mingw32\\\\bin',
            'C:\\\\MinGW\\\\bin',
            'C:\\\\TDM-GCC-64\\\\bin',
            'C:\\\\Program Files\\\\mingw-w64\\\\x86_64-8.1.0-posix-seh-rt_v6-rev0\\\\mingw64\\\\bin',
        ];
        
        for (const compiler of compilers) {
            try {
                execSync(\`\${compiler} --version\`, { stdio: 'ignore' });
                return compiler;
            } catch (e) {}
        }
        
        if (platform === 'win32') {
            for (const basePath of windowsPaths) {
                for (const compiler of ['g++.exe', 'gcc.exe', 'clang++.exe']) {
                    const fullPath = path.join(basePath, compiler);
                    try {
                        if (fs.existsSync(fullPath)) {
                            fs.accessSync(fullPath, fs.constants.X_OK);
                            return fullPath;
                        }
                    } catch (e) {}
                }
            }
        }
        
        return null;
    },
    
    execute: function(filePath, code) {
        return new Promise((resolve, reject) => {
            const ext = path.extname(filePath);
            const basename = path.basename(filePath, ext);
            const outputFile = path.join(
                os.tmpdir(), 
                basename + (process.platform === 'win32' ? '.exe' : '')
            );
            
            console.log(\`🔨 Compiling \${path.basename(filePath)}...\`);
            
            const compiler = this.findCompiler();
            
            if (!compiler) {
                console.error('❌ C++ compiler not found!');
                console.error('');
                console.error('📥 Please install a C++ compiler:');
                console.error('');
                if (process.platform === 'win32') {
                    console.error('   Windows Options:');
                    console.error('   1. MSYS2: https://www.msys2.org/ (recommended)');
                    console.error('      After installing, run: pacman -S mingw-w64-ucrt-x86_64-gcc');
                    console.error('   2. MinGW-w64: https://www.mingw-w64.org/downloads/');
                    console.error('   3. Visual Studio: https://visualstudio.microsoft.com/');
                } else if (process.platform === 'darwin') {
                    console.error('   macOS: xcode-select --install');
                } else {
                    console.error('   Linux:');
                    console.error('   sudo apt install build-essential    # Ubuntu/Debian');
                    console.error('   sudo yum groupinstall "Development Tools"  # RHEL/CentOS');
                }
                console.error('');
                return reject(new Error('C++ compiler not found'));
            }
            
            const isC = ext === '.c';
            const compileArgs = [filePath, '-o', outputFile];
            if (!isC) compileArgs.push('-std=c++17');
            
            const compileProcess = spawn(compiler, compileArgs);
            
            let compileError = '';
            compileProcess.stderr.on('data', data => {
                compileError += data.toString();
            });
            
            compileProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error('❌ Compilation failed:');
                    console.error(compileError);
                    return reject(new Error('Compilation failed'));
                }
                
                console.log('✅ Compilation successful!');
                console.log('🚀 Running program...\\n');
                console.log('─'.repeat(50));
                
                const runProcess = spawn(outputFile, [], { stdio: 'inherit' });
                
                runProcess.on('close', (runCode) => {
                    console.log('─'.repeat(50));
                    console.log(\`\\n✨ Program exited with code \${runCode}\`);
                    
                    try {
                        fs.unlinkSync(outputFile);
                    } catch (e) {}
                    
                    resolve();
                });
                
                runProcess.on('error', (err) => {
                    console.error('❌ Runtime error:', err.message);
                    reject(err);
                });
            });
            
            compileProcess.on('error', (err) => {
                console.error('❌ Compilation error:', err.message);
                reject(err);
            });
        });
    }
};
`;
        fs.writeFileSync(path.join(pluginsDir, 'cpp-plugin.js'), cppPlugin);
        
        // ========== FIXED JAVASCRIPT PLUGIN ==========
        const jsPlugin = `// JavaScript Plugin for Shine v1.0.1
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'javascript-runner',
    version: '1.0.1',
    description: 'Runs JavaScript files',
    
    init: function() {
        console.log('✨ JavaScript plugin loaded!');
    },
    
    extensions: ['.js'],
    
    execute: function(filePath, code) {
        return new Promise((resolve, reject) => {
            try {
                console.log(\`✨ Running JavaScript: \${path.basename(filePath)}\`);
                console.log('─'.repeat(50));
                
                const absolutePath = path.resolve(filePath);
                const fileDir = path.dirname(absolutePath);
                
                delete require.cache[absolutePath];
                
                const originalCwd = process.cwd();
                process.chdir(fileDir);
                
                try {
                    require(absolutePath);
                    
                    console.log('─'.repeat(50));
                    console.log('✨ JavaScript execution completed!');
                    
                    process.chdir(originalCwd);
                    resolve();
                } catch (execError) {
                    process.chdir(originalCwd);
                    throw execError;
                }
            } catch (err) {
                console.log('─'.repeat(50));
                console.error('❌ JavaScript error:', err.message);
                if (err.stack) {
                    console.error(err.stack);
                }
                reject(err);
            }
        });
    }
};
`;
        fs.writeFileSync(path.join(pluginsDir, 'js-plugin.js'), jsPlugin);
    }
}

function createReadme(installPath) {
    const readmePath = path.join(installPath, 'README.md');
    const hasNodeBundle = fs.existsSync(path.join(installPath, platform === 'win32' ? 'node.exe' : 'node'));
    
    const readmeContent = `# 🦄 Shine - UnicornLang Runner

Welcome to Shine! Your local installation of the Shine UnicornLang runner.

${hasNodeBundle ? '✅ **Node.js is bundled** - No separate installation required!' : '⚠️ **Note:** Node.js must be installed separately to use Shine.'}

## 🚀 Quick Start

### Running UnicornLang Files
\`\`\`bash
shine myprogram.unicorn
\`\`\`

### Running JavaScript Files
\`\`\`bash
shine hello.js
\`\`\`

### Running C++ Files
\`\`\`bash
shine hello.cpp
\`\`\`

## ⚙️ Prerequisites

${hasNodeBundle ? '### ✅ JavaScript Runtime\nNode.js is already included with Shine!\n' : '### Node.js\nDownload from https://nodejs.org/\n'}

### For C++ Compilation

**Windows (Choose one):**
1. **MSYS2** (recommended)
   - Download: https://www.msys2.org/
   - After install: \`pacman -S mingw-w64-ucrt-x86_64-gcc\`
   - Add to PATH: \`C:\\msys64\\ucrt64\\bin\`

2. **MinGW-w64**
   - Download: https://www.mingw-w64.org/downloads/

3. **Visual Studio**
   - Install with C++ support

**macOS:**
\`\`\`bash
xcode-select --install
\`\`\`

**Linux:**
\`\`\`bash
# Ubuntu/Debian
sudo apt install build-essential

# RHEL/CentOS/Fedora  
sudo yum groupinstall "Development Tools"

# Arch
sudo pacman -S base-devel
\`\`\`

## 📚 UnicornLang Syntax

### Variables
\`\`\`unicorn
fairy name = "Alice";         // const
magic age = 25;               // let (number)
dragon count = 10;            // let (any)
pixie isActive = yes;         // boolean
pixieDust colors = [1,2,3];   // array
\`\`\`

### Output
\`\`\`unicorn
twinkle "Hello World";  // ✨ Hello World ✨
\`\`\`

### Functions
\`\`\`unicorn
rainbow add(a, b) {
    return a + b;
}

magic result = add(5, 10);
twinkle result;
\`\`\`

### Control Flow
\`\`\`unicorn
if (age >= 18) {
    twinkle "Adult";
} unless {
    twinkle "Minor";
}
\`\`\`

### Loops
\`\`\`unicorn
repeat 5 times {
    twinkle "Hello!";
}
\`\`\`

## 📌 Plugins

### List Plugins
\`\`\`bash
shine plugins
\`\`\`

### Examples

**C++ (test.cpp):**
\`\`\`cpp
#include <iostream>
int main() {
    std::cout << "Hello C++!" << std::endl;
    return 0;
}
\`\`\`

**JavaScript (hello.js):**
\`\`\`javascript
console.log("Hello JavaScript!");
\`\`\`

Run with: \`shine test.cpp\` or \`shine hello.js\`

## 🔄 Updates

\`\`\`bash
shine update
\`\`\`

## 🛠️ Commands

| Command | Description |
|---------|-------------|
| \`shine <file>\` | Run a file |
| \`shine update\` | Check for updates |
| \`shine plugins\` | List plugins |
| \`shine help\` | Show help |

## 🛠️ Troubleshooting

### Command not found: shine

${platform === 'win32' 
    ? 'Restart your terminal or computer.'
    : 'Run: \`source ~/.zshrc\` or \`source ~/.bashrc\`'}

### C++ compilation fails

Install a C++ compiler (see Prerequisites above).

Test: \`g++ --version\`

## 📞 Support

Visit: https://fiana.qzz.io

---

**Installation**: ${new Date().toLocaleString()}
**Version**: 1.0.7
**Platform**: ${platform}
${hasNodeBundle ? '**Node.js**: Bundled ✅' : '**Node.js**: External ⚠️'}

Made with ✨ by Fiana-dev
`;

    fs.writeFileSync(readmePath, readmeContent);
    return readmePath;
}

async function performInstallation(installPath, win) {
    try {
        if (!installPath) throw new Error("No installation path provided");

        const shinePath = path.join(installPath, 'Shine');
        fs.mkdirSync(shinePath, { recursive: true });

        console.log('📝 Installing Shine runner...');
        const runnerPath = path.join(shinePath, 'shine.js');
        fs.writeFileSync(runnerPath, shineCode);

        // ⭐ Bundle Node.js from Electron
        createNodeWrapper(shinePath);

        console.log('🔧 Creating wrapper scripts...');
        makeTerminalWrapper(runnerPath, shinePath);
        
        console.log('🔗 Setting up file associations...');
        associateFiles(shinePath);
        
        console.log('📦 Installing plugins...');
        createPluginsDirectory(shinePath);
        
        console.log('📖 Creating documentation...');
        const readmePath = createReadme(shinePath);
        
        console.log('🛤️  Adding to PATH...');
        addToPath(shinePath);

        const hasNodeBundle = fs.existsSync(path.join(shinePath, platform === 'win32' ? 'node.exe' : 'node'));
        
        let pathMsg = '';
        if (platform === 'win32') {
            pathMsg = '\n\n⚠️ Please restart your terminal or log out and back in for PATH changes to take effect.';
        } else {
            pathMsg = '\n\n⚠️ Please restart your terminal or run: source ~/.zshrc (or ~/.bashrc)';
        }

        const message = `✨ Shine installed successfully at ${shinePath}! ✨${hasNodeBundle ? '\n\n✅ Node.js bundled - no separate installation needed!' : '\n\n⚠️ You\'ll need to install Node.js separately.'}${pathMsg}`;
        
        if (hideFlag) {
            console.log(message);
            setTimeout(() => app.quit(), 2000);
        } else {
            if (win) {
                win.webContents.send('installation-complete', { 
                    message, 
                    readmePath,
                    shinePath 
                });
            }
        }
        
        return { success: true, message, readmePath, shinePath };
    } catch (err) {
        const errorMsg = `Installation failed: ${err.message}`;
        console.error(errorMsg);
        console.error(err.stack);
        return { success: false, message: errorMsg };
    }
}

// --- IPC handlers ---
ipcMain.handle('get-default-path', async () => {
    if (platform === 'win32') {
        return path.join(homeDir, 'AppData', 'Local');
    } else {
        return homeDir;
    }
});

ipcMain.handle('select-path', async () => {
    const result = await dialog.showOpenDialog({ 
        properties: ['openDirectory'],
        title: 'Select Installation Location',
        buttonLabel: 'Select'
    });
    return result.filePaths[0];
});

ipcMain.handle('install-shine', async (event, installPath) => {
    return await performInstallation(installPath, BrowserWindow.getFocusedWindow());
});

ipcMain.handle('open-readme', async (event, readmePath) => {
    try {
        await shell.openPath(readmePath);
        return { success: true };
    } catch (err) {
        console.error('Failed to open README:', err);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('open-folder', async (event, folderPath) => {
    try {
        await shell.openPath(folderPath);
        return { success: true };
    } catch (err) {
        console.error('Failed to open folder:', err);
        return { success: false, error: err.message };
    }
});