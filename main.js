const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const platform = os.platform();
const homeDir = os.homedir();

// Load Unicorn runner
const shineCode = fs.readFileSync(path.join(__dirname, 'shine.js'), 'utf-8');

function createWindow() {
    const win = new BrowserWindow({
        width: 550,
        height: 450,
        resizable: false,
        autoHideMenuBar: true,
        menuBarVisible: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
        icon: path.join(__dirname, 'icon.png')
    });
    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

// --- Helper functions ---
function isAdmin() {
    if (platform === 'win32') {
        try { execSync('fsutil dirty query %systemdrive%'); return true; }
        catch { return false; }
    } else {
        return process.getuid && process.getuid() === 0;
    }
}

function addToPath(installPath) {
    if (platform === 'win32') {
        try {
            // Add to user PATH on Windows
            const currentPath = execSync('powershell -Command "[Environment]::GetEnvironmentVariable(\'Path\', \'User\')"', { encoding: 'utf-8' }).trim();
            if (!currentPath.includes(installPath)) {
                const newPath = currentPath ? `${currentPath};${installPath}` : installPath;
                execSync(`powershell -Command "[Environment]::SetEnvironmentVariable('Path', '${newPath.replace(/'/g, "''")}', 'User')"`);
                // Broadcast environment change
                execSync('powershell -Command "& {[System.Environment]::SetEnvironmentVariable(\'Dummy\', \'Value\', \'User\'); Remove-Item Env:\\Dummy}"');
            }
        } catch (err) {
            console.error('Failed to add to PATH:', err);
        }
    } else if (platform === 'darwin') {
        // Add to .zshrc and .bash_profile for macOS
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
        // Add to .bashrc for Linux
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
}

function makeTerminalWrapper(runnerPath, installPath) {
    if (platform === 'win32') {
        const wrapperPath = path.join(installPath, 'shine.cmd');
        fs.writeFileSync(wrapperPath, `@echo off
node "${runnerPath}" %*
echo.
echo ✨ Press any key to close ✨
pause >nul
`);
    } else if (platform === 'darwin' || platform === 'linux') {
        fs.chmodSync(runnerPath, 0o755);
    }
}

function associateFiles(installPath) {
    if (platform === 'win32') {
        try {
            execSync(`assoc .unicorn=UnicornFile`);
            execSync(`ftype UnicornFile="${path.join(installPath, 'shine.cmd')}" "%1"`);
            execSync(`reg add "HKCR\\UnicornFile\\DefaultIcon" /ve /t REG_SZ /d "${path.join(__dirname,'icon.ico')}" /f`);
        } catch {}
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
        execSync(`update-mime-database ~/.local/share/mime`);
    } else if (platform === 'darwin') {
        // macOS file association handled in .app bundle
    }
}

// --- IPC from renderer ---
ipcMain.handle('select-path', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.filePaths[0];
});

ipcMain.handle('install-shine', async (event, installPath) => {
    try {
        if (!installPath) throw new Error("No folder selected");

        const admin = isAdmin();
        const targetPath = admin ? (platform === 'win32' ? 'C:\\Program Files\\Shine' : '/usr/local/bin') : installPath;
        fs.mkdirSync(targetPath, { recursive: true });

        const runnerPath = path.join(targetPath, platform === 'win32' ? 'shine.js' : 'shine');
        fs.writeFileSync(runnerPath, shineCode, { mode: 0o755 });

        makeTerminalWrapper(runnerPath, targetPath);
        associateFiles(targetPath);
        
        // Add to PATH if not installing to system directory
        if (!admin || platform === 'win32') {
            addToPath(targetPath);
        }

        let pathMsg = '';
        if (platform === 'win32') {
            pathMsg = '\n\n⚠️ Please restart your terminal or log out and back in for PATH changes to take effect.';
        } else if (platform === 'darwin' || platform === 'linux') {
            pathMsg = '\n\n⚠️ Please restart your terminal or run: source ~/.zshrc (or ~/.bashrc)';
        }

        return { success: true, message: `✨ Shine installed successfully at ${targetPath}! ✨${pathMsg}` };
    } catch (err) {
        return { success: false, message: err.message };
    }
});