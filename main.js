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
    // Find existing Shine installation
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
    
    // Auto-install if -hide flag is present
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

function makeTerminalWrapper(runnerPath, installPath) {
    if (platform === 'win32') {
        const wrapperPath = path.join(installPath, 'shine.cmd');
        fs.writeFileSync(wrapperPath, `@echo off
node "${runnerPath}" %*
if errorlevel 1 (
    echo.
    echo ✨ Error occurred! Press any key to close ✨
    pause >nul
)
`);
    } else {
        fs.chmodSync(runnerPath, 0o755);
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
Exec=gnome-terminal -- bash -c "shine %f; echo '✨ Press Enter to close ✨'; read"
Icon=${path.join(__dirname,'icon.png')}
Type=Application
MimeType=text/x-unicorn;
`);
            try {
                execSync(`update-mime-database ~/.local/share/mime`, { stdio: 'ignore' });
            } catch (e) {
                // Ignore if command not available
            }
        }
    } catch (err) {
        console.error('File association failed:', err.message);
    }
}

function createPluginsDirectory(installPath) {
    const pluginsDir = path.join(installPath, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
        
        // Create C++ plugin with Windows compiler detection
        const cppPlugin = `// C++ Plugin for Shine
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
    name: 'cpp-compiler',
    version: '1.0.0',
    description: 'Compiles and runs C++ files',
    
    init: function() {
        console.log('✨ C++ compiler plugin loaded!');
    },
    
    extensions: ['.cpp', '.cc', '.cxx', '.c'],
    
    execute: function(filePath, code) {
        return new Promise((resolve, reject) => {
            const ext = path.extname(filePath);
            const basename = path.basename(filePath, ext);
            const outputFile = path.join(
                os.tmpdir(), 
                basename + (process.platform === 'win32' ? '.exe' : '')
            );
            
            console.log(\`🔨 Compiling \${path.basename(filePath)}...\`);
            
            const isC = ext === '.c';
            let compiler = isC ? 'gcc' : 'g++';
            
            // Windows compiler detection
            if (process.platform === 'win32') {
                // Try common Windows compiler paths
                const possibleCompilers = [
                    'g++', 'gcc',
                    'C:\\\\msys64\\\\mingw64\\\\bin\\\\g++.exe',
                    'C:\\\\msys64\\\\mingw32\\\\bin\\\\g++.exe', 
                    'C:\\\\MinGW\\\\bin\\\\g++.exe',
                    'C:\\\\Program Files\\\\mingw-w64\\\\x86_64-8.1.0-posix-seh-rt_v6-rev0\\\\mingw64\\\\bin\\\\g++.exe'
                ];
                
                for (const comp of possibleCompilers) {
                    try {
                        fs.accessSync(comp, fs.constants.X_OK);
                        compiler = comp;
                        break;
                    } catch (e) {
                        // Try next compiler
                    }
                }
            }
            
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
                if (err.code === 'ENOENT') {
                    console.error(\`❌ C++ compiler not found! Please install a C++ compiler.\`);
                    console.error('   Windows: Install MinGW-w64 from https://www.mingw-w64.org/');
                    console.error('   Linux: sudo apt install build-essential');
                    console.error('   macOS: xcode-select --install');
                    console.error('   Or install Visual Studio with C++ support');
                } else {
                    console.error('❌ Compilation error:', err.message);
                }
                reject(err);
            });
        });
    }
};
`;
        fs.writeFileSync(path.join(pluginsDir, 'cpp-plugin.js'), cppPlugin);
        
        // Create JavaScript plugin
        const jsPlugin = `// JavaScript Plugin for Shine
const fs = require('fs');
const path = require('path');

module.exports = {
    name: 'javascript-runner',
    version: '1.0.0',
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
                
                // Execute the JavaScript file
                const modulePath = require.resolve(filePath);
                delete require.cache[modulePath];
                require(filePath);
                
                console.log('─'.repeat(50));
                console.log('✨ JavaScript execution completed!');
                resolve();
            } catch (err) {
                console.error('❌ JavaScript error:', err.message);
                console.error(err.stack);
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
    const readmeContent = `# 🦄 Shine - UnicornLang Runner

Welcome to Shine! This is your local installation of the Shine UnicornLang runner.

## 🚀 Quick Start

### Running UnicornLang Files

\`\`\`bash
shine myprogram.unicorn
\`\`\`

### Example UnicornLang Program

Create a file called \`hello.unicorn\`:

\`\`\`unicorn
twinkle "Hello, World!";

fairy name = "Alice";
magic age = 25;

rainbow greet(person) {
    twinkle "Hello, " + person + "!";
}

greet(name);
\`\`\`

Run it:
\`\`\`bash
shine hello.unicorn
\`\`\`

## 📚 UnicornLang Syntax

### Variables
\`\`\`unicorn
fairy name = "Alice";         // const - immutable
magic age = 25;               // let - mutable number
dragon count = 10;            // let - mutable
pixie isActive = yes;         // boolean (yes/no)
pixieDust colors = [1,2,3];   // array
\`\`\`

### Output
\`\`\`unicorn
twinkle "Hello World";  // Outputs: ✨ Hello World ✨
\`\`\`

### Functions
\`\`\`unicorn
rainbow add(a, b) {
    return a + b;
}

magic result = add(5, 10);
twinkle result;
\`\`\`

### Classes
\`\`\`unicorn
sparkle Person {
    rainbow init(name, age) {
        this.name = name;
        this.age = age;
    }
    
    sayHello() {
        twinkle "Hi, I'm " + this.name;
    }
}

magic person = new Person("Bob", 30);
person.sayHello();
\`\`\`

### Control Flow
\`\`\`unicorn
magic age = 20;

if (age >= 18) {
    twinkle "Adult";
} unless {
    twinkle "Minor";
}
\`\`\`

### Error Handling
\`\`\`unicorn
try {
    // Risky code here
    magic result = 10 / 0;
} catch (error) {
    twinkle "An error occurred!";
}
\`\`\`

## 🔌 Using Plugins

Shine supports plugins to run other programming languages!

### List Available Plugins
\`\`\`bash
shine plugins
\`\`\`

### Using the C++ Plugin

Create a file called \`hello.cpp\`:

\`\`\`cpp
#include <iostream>

int main() {
    std::cout << "Hello from C++!" << std::endl;
    return 0;
}
\`\`\`

Run it with Shine:
\`\`\`bash
shine hello.cpp
\`\`\`

Shine will automatically compile and run it!

## 🔄 Updating Shine

Check for and download updates:

\`\`\`bash
shine update
\`\`\`

This will download the latest installer. To auto-update:

\`\`\`bash
./Shine.Unicorn.Installer.Setup.{version}.exe -hide
\`\`\`

## 📁 Installation Directory

Your Shine installation is located at:
**${installPath}**

### Directory Structure
\`\`\`
${installPath}/
├── shine.js (or shine)    # Main runner
├── shine.cmd              # Windows wrapper (Windows only)
├── plugins/               # Plugin directory
│   └── cpp-plugin.js
└── README.md             # This file
\`\`\`

## 🛠️ Useful Commands

| Command | Description |
|---------|-------------|
| \`shine <file>\` | Run a UnicornLang or supported file |
| \`shine update\` | Check for and download updates |
| \`shine plugins\` | List all loaded plugins |
| \`shine help\` | Show help information |

## 🐛 Troubleshooting

### Command not found: shine

${platform === 'win32' 
    ? '**Windows**: Close and reopen your terminal, or restart your computer.'
    : '**macOS/Linux**: Run \`source ~/.zshrc\` or \`source ~/.bashrc\`'}

### Plugin not working

1. Check that the plugin file exists in the \`plugins\` directory
2. Run \`shine plugins\` to see if it's loaded
3. Check the plugin file for syntax errors

### C++ compilation fails

Make sure you have a C++ compiler installed:

- **Windows**: Install MinGW-w64 or Visual Studio
- **macOS**: Run \`xcode-select --install\`
- **Linux**: Run \`sudo apt install build-essential\`

## 💡 Examples

### Calculator
\`\`\`unicorn
rainbow calculate(a, b, operation) {
    if (operation == "add") {
        return a + b;
    } unless {
        if (operation == "multiply") {
            return a * b;
        }
    }
}

magic result = calculate(10, 5, "add");
twinkle "Result: " + result;
\`\`\`

### Person Class
\`\`\`unicorn
sparkle Person {
    rainbow init(name, age) {
        this.name = name;
        this.age = age;
    }
    
    introduce() {
        twinkle "I'm " + this.name + " and I'm " + this.age + " years old";
    }
}

magic alice = new Person("Alice", 25);
alice.introduce();
\`\`\`

## 🌟 Tips

1. **File Extensions**: UnicornLang files use the \`.unicorn\` extension
2. **PATH Setup**: Shine is added to your PATH automatically
3. **File Associations**: Double-click \`.unicorn\` files to run them
4. **Plugins**: Extend Shine to support any language you want!
5. **Updates**: Run \`shine update\` regularly to get the latest features

## 📞 Support

For issues, questions, or contributions, visit: https://fiana.qzz.io

---

**Installation Date**: ${new Date().toLocaleString()}
**Shine Version**: 1.0.4
**Platform**: ${platform}

Made with ✨ by Fiana-dev

Happy coding! 🦄✨
`;

    fs.writeFileSync(readmePath, readmeContent);
    return readmePath;
}

async function performInstallation(installPath, win) {
    try {
        if (!installPath) throw new Error("No installation path provided");

        // Create Shine directory
        const shinePath = path.join(installPath, 'Shine');
        fs.mkdirSync(shinePath, { recursive: true });

        const runnerPath = path.join(shinePath, platform === 'win32' ? 'shine.js' : 'shine');
        fs.writeFileSync(runnerPath, shineCode, { mode: 0o755 });

        makeTerminalWrapper(runnerPath, shinePath);
        associateFiles(shinePath);
        createPluginsDirectory(shinePath);
        
        // Create README and get its path
        const readmePath = createReadme(shinePath);
        
        addToPath(shinePath);

        let pathMsg = '';
        if (platform === 'win32') {
            pathMsg = '\n\n⚠️ Please restart your terminal or log out and back in for PATH changes to take effect.';
        } else if (platform === 'darwin' || platform === 'linux') {
            pathMsg = '\n\n⚠️ Please restart your terminal or run: source ~/.zshrc (or ~/.bashrc)';
        }

        const message = `✨ Shine installed successfully at ${shinePath}! ✨${pathMsg}`;
        
        if (hideFlag) {
            console.log(message);
            setTimeout(() => app.quit(), 2000);
        } else {
            // Send the README path to renderer so it can prompt user
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
        return { success: false, message: errorMsg };
    }
}

// --- IPC from renderer ---
ipcMain.handle('get-default-path', async () => {
    // Suggest default installation path
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