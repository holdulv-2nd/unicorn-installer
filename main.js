const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

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

// Helper function to copy directories recursively
function copyDirRecursive(source, target) {
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }
    
    const files = fs.readdirSync(source);
    
    files.forEach(file => {
        const sourcePath = path.join(source, file);
        const targetPath = path.join(target, file);
        
        try {
            const stat = fs.statSync(sourcePath);
            
            if (stat.isDirectory()) {
                copyDirRecursive(sourcePath, targetPath);
            } else {
                fs.copyFileSync(sourcePath, targetPath);
            }
        } catch (err) {
            console.warn(`⚠️  Could not copy ${file}:`, err.message);
        }
    });
}

// ⭐ NEW: Copy entire Electron app folder and rename to "node"
function copyElectronApp(installPath) {
    console.log('📦 Bundling full Node.js runtime (Electron)...');
    
    try {
        const electronAppPath = process.execPath;
        const electronDir = path.dirname(electronAppPath);
        const targetDir = path.join(installPath, 'node');
        
        // Create target directory
        fs.mkdirSync(targetDir, { recursive: true });
        
        // Copy all files from Electron directory
        const files = fs.readdirSync(electronDir);
        
        files.forEach(file => {
            // Skip some unnecessary large files to save space
            if (file === 'swiftshader' || file === 'vk_swiftshader_icd.json') {
                return;
            }
            
            const sourcePath = path.join(electronDir, file);
            const targetPath = path.join(targetDir, file);
            
            try {
                const stat = fs.statSync(sourcePath);
                
                if (stat.isDirectory()) {
                    // Copy directory recursively
                    copyDirRecursive(sourcePath, targetPath);
                } else {
                    // Copy file
                    fs.copyFileSync(sourcePath, targetPath);
                }
            } catch (err) {
                console.warn(`⚠️  Could not copy ${file}:`, err.message);
            }
        });
        
        // Rename the main executable to node.exe (Windows) or node (Unix)
        const originalExeName = path.basename(process.execPath);
        const originalExePath = path.join(targetDir, originalExeName);
        const newExeName = platform === 'win32' ? 'node.exe' : 'node';
        const newExePath = path.join(targetDir, newExeName);
        
        if (fs.existsSync(originalExePath) && originalExeName !== newExeName) {
            try {
                fs.renameSync(originalExePath, newExePath);
                console.log(`✅ Renamed ${originalExeName} to ${newExeName}`);
            } catch (err) {
                console.warn(`⚠️  Could not rename executable:`, err.message);
                // If rename fails, try copy
                fs.copyFileSync(originalExePath, newExePath);
                fs.unlinkSync(originalExePath);
            }
        }
        
        // Make executable on Unix systems
        if (platform !== 'win32') {
            try {
                fs.chmodSync(newExePath, 0o755);
            } catch (err) {
                console.warn('⚠️  Could not set executable permissions:', err.message);
            }
        }
        
        console.log('✅ Full Node.js runtime bundled successfully');
        return targetDir;
    } catch (err) {
        console.error('⚠️  Failed to bundle Node.js runtime:', err.message);
        throw err;
    }
}

// ⭐ UPDATED: Terminal wrapper to use bundled node with proper flags
function makeTerminalWrapper(runnerPath, installPath, nodeDir) {
    const nodePath = path.join(nodeDir, platform === 'win32' ? 'node.exe' : 'node');
    
    if (platform === 'win32') {
        // Create shine.cmd wrapper (for Shine CLI)
        const shineCmdPath = path.join(installPath, 'shine.cmd');
        fs.writeFileSync(shineCmdPath, `@echo off
set ELECTRON_RUN_AS_NODE=1
"${nodePath}" "${runnerPath}" %*
if errorlevel 1 (
    echo.
    echo ✨ Error occurred! Press any key to close ✨
    pause >nul
)
`);

        // Create node.cmd wrapper (for general Node.js/Electron use)
        const nodeCmdPath = path.join(installPath, 'node.cmd');
        fs.writeFileSync(nodeCmdPath, `@echo off
REM General purpose node/electron wrapper
REM Use: node script.js (runs as Node.js)
REM Use: electron app/ (runs as Electron app)
if "%1"=="" (
    echo Usage: node script.js
    echo    or: electron app_folder
    exit /b 1
)
"${nodePath}" %*
`);

        // Create electron.cmd wrapper (for Electron apps)
        const electronCmdPath = path.join(installPath, 'electron.cmd');
        fs.writeFileSync(electronCmdPath, `@echo off
REM Electron app launcher
"${nodePath}" %*
`);
        
    } else {
        // Create shine wrapper (for Shine CLI)
        const shineWrapperPath = path.join(installPath, 'shine');
        fs.writeFileSync(shineWrapperPath, `#!/bin/bash
export ELECTRON_RUN_AS_NODE=1
"${nodePath}" "${runnerPath}" "$@"
`, { mode: 0o755 });

        // Create node wrapper (for general Node.js use)
        const nodeWrapperPath = path.join(installPath, 'node-runner');
        fs.writeFileSync(nodeWrapperPath, `#!/bin/bash
# General purpose node/electron wrapper
# Use with ELECTRON_RUN_AS_NODE=1 for Node.js mode
# Use without for Electron app mode
"${nodePath}" "$@"
`, { mode: 0o755 });

        // Create electron wrapper (for Electron apps)
        const electronWrapperPath = path.join(installPath, 'electron');
        fs.writeFileSync(electronWrapperPath, `#!/bin/bash
# Electron app launcher
"${nodePath}" "$@"
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
                console.error('🔥 Please install a C++ compiler:');
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
    const hasFullNode = fs.existsSync(path.join(installPath, 'node'));
    
    const readmeContent = `# 🦄 Shine - UnicornLang Runner

Welcome to Shine! Your local installation of the Shine UnicornLang runner.

${hasFullNode ? '✅ **Full Node.js runtime bundled** - Completely standalone! No dependencies required!' : '⚠️ **Note:** Using system Node.js runtime.'}

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

## 🎯 Using the Bundled Runtime

Shine includes a bundled Electron/Node.js runtime. You can use it for:

### For Shine (default)
\`\`\`bash
shine script.unicorn
\`\`\`

### For Electron Apps
\`\`\`bash
${platform === 'win32' ? 'electron' : 'electron'} path/to/electron-app
\`\`\`

### For Node.js Scripts (as Node.js runtime)
\`\`\`bash
${platform === 'win32' ? 'node' : 'ELECTRON_RUN_AS_NODE=1 node-runner'} script.js
\`\`\`

### For Pure Electron Apps (GUI mode)
\`\`\`bash
${platform === 'win32' ? 'electron' : 'electron'} .
\`\`\`

**Note:** The bundled runtime can run both Node.js scripts (with ELECTRON_RUN_AS_NODE=1) and full Electron GUI applications.

## ⚙️ Prerequisites

${hasFullNode ? '### ✅ Runtime Environment\nNode.js/Electron runtime is already included with Shine! No additional dependencies needed.\n' : '### Node.js Runtime\nUsing system Node.js installation.\n'}

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

## 🔌 Plugins

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

This will automatically download and install the latest version!

## 🛠️ Commands

| Command | Description |
|---------|-------------|
| \`shine <file>\` | Run a file |
| \`shine update\` | Check and install updates |
| \`shine plugins\` | List plugins |
| \`shine help\` | Show help |
| \`electron <app>\` | Run an Electron app |
| \`node <script>\` | Run a Node.js script |

## 💡 Advanced Usage

### Running Your Own Electron Apps

If you have an Electron app, you can use the bundled runtime:

\`\`\`bash
# Navigate to your Electron app directory
cd my-electron-app

# Run it with the bundled Electron
${platform === 'win32' ? 'electron' : 'electron'} .
\`\`\`

### Using as Node.js Runtime

${platform === 'win32' 
    ? 'The bundled \`node.cmd\` wrapper can run Node.js scripts:\n\n\`\`\`bash\nnode myscript.js\n\`\`\`' 
    : 'You can run Node.js scripts with the bundled runtime:\n\n\`\`\`bash\nELECTRON_RUN_AS_NODE=1 node-runner myscript.js\n\`\`\`\n\nOr create an alias:\n\`\`\`bash\nalias node-shine="ELECTRON_RUN_AS_NODE=1 node-runner"\nnode-shine myscript.js\n\`\`\`'}

## 🛠️ Troubleshooting

### Command not found: shine

${platform === 'win32' 
    ? 'Restart your terminal or computer.'
    : 'Run: \`source ~/.zshrc\` or \`source ~/.bashrc\`'}

### C++ compilation fails

Install a C++ compiler (see Prerequisites above).

Test: \`g++ --version\`

### Electron app won't start

Make sure you're using the \`electron\` command, not \`shine\`:
\`\`\`bash
electron path/to/app
\`\`\`

## 📞 Support

Visit: https://fiana.qzz.io

---

**Installation**: ${new Date().toLocaleString()}
**Version**: 1.0.8
**Platform**: ${platform}
${hasFullNode ? '**Runtime**: Full Node.js/Electron Bundled ✅' : '**Runtime**: System Node.js ⚠️'}
**Bundled Tools**: shine, electron, node

Made with ✨ by Fiana-dev
`;

    fs.writeFileSync(readmePath, readmeContent);
    return readmePath;
}

// ⭐ UPDATED: Installation function
async function performInstallation(installPath, win) {
    try {
        if (!installPath) throw new Error("No installation path provided");

        const shinePath = path.join(installPath, 'Shine');
        fs.mkdirSync(shinePath, { recursive: true });

        console.log('📦 Bundling complete Node.js runtime...');
        const nodeDir = copyElectronApp(shinePath);

        console.log('📝 Installing Shine runner...');
        const runnerPath = path.join(shinePath, 'shine.js');
        fs.writeFileSync(runnerPath, shineCode);

        console.log('🔧 Creating wrapper scripts...');
        makeTerminalWrapper(runnerPath, shinePath, nodeDir);
        
        console.log('🔗 Setting up file associations...');
        associateFiles(shinePath);
        
        console.log('📦 Installing plugins...');
        createPluginsDirectory(shinePath);
        
        console.log('📖 Creating documentation...');
        const readmePath = createReadme(shinePath);
        
        console.log('🛤️ Adding to PATH...');
        addToPath(shinePath);

        const hasFullNode = fs.existsSync(path.join(shinePath, 'node'));
        
        let pathMsg = '';
        if (platform === 'win32') {
            pathMsg = '\n\n⚠️ Please restart your terminal or log out and back in for PATH changes to take effect.';
        } else {
            pathMsg = '\n\n⚠️ Please restart your terminal or run: source ~/.zshrc (or ~/.bashrc)';
        }

        const message = `✨ Shine installed successfully at ${shinePath}! ✨${hasFullNode ? '\n\n✅ Full Node.js runtime bundled - completely standalone!' : '\n\n⚠️ Using system Node.js runtime.'}${pathMsg}`;
        
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