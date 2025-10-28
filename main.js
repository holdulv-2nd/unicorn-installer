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

        return { success: true, message: `✨ Shine installed successfully at ${targetPath}! ✨` };
    } catch (err) {
        return { success: false, message: err.message };
    }
});
