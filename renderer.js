const { ipcRenderer } = require('electron');

let installPath = null;
let readmePath = null;
let shinePath = null;

const pathDisplay = document.getElementById('pathDisplay');
const installBtn = document.getElementById('install');
const statusDiv = document.getElementById('status');
const spinner = document.getElementById('spinner');
const completionActions = document.getElementById('completionActions');

// Get default path on load
(async () => {
    const defaultPath = await ipcRenderer.invoke('get-default-path');
    if (defaultPath) {
        installPath = defaultPath;
        updatePathDisplay();
    }
})();

function updatePathDisplay() {
    if (installPath) {
        const path = require('path');
        const shinePath = path.join(installPath, 'Shine');
        pathDisplay.textContent = shinePath;
        pathDisplay.classList.add('has-path');
        installBtn.disabled = false;
    } else {
        pathDisplay.textContent = 'Click "Browse" to select installation location';
        pathDisplay.classList.remove('has-path');
        installBtn.disabled = true;
    }
}

function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = 'status show ' + type;
}

function hideStatus() {
    statusDiv.classList.remove('show');
}

document.getElementById('pickPath').addEventListener('click', async () => {
    try {
        const path = await ipcRenderer.invoke('select-path');
        if (path) {
            installPath = path;
            updatePathDisplay();
            hideStatus();
        }
    } catch (err) {
        showStatus('Failed to select path: ' + err.message, 'error');
    }
});

document.getElementById('install').addEventListener('click', async () => {
    if (!installPath) {
        showStatus('⚠️ Please select an installation location first!', 'error');
        return;
    }
    
    try {
        installBtn.disabled = true;
        document.getElementById('pickPath').disabled = true;
        spinner.classList.add('show');
        showStatus('Installing Shine... ✨', 'info');
        
        const result = await ipcRenderer.invoke('install-shine', installPath);
        
        spinner.classList.remove('show');
        
        if (result.success) {
            showStatus(result.message, 'success');
            
            // Store paths for later use
            readmePath = result.readmePath;
            shinePath = result.shinePath;
            
            // Show completion actions after a brief delay
            setTimeout(() => {
                completionActions.classList.add('show');
                showStatus('✅ Installation complete! Check out the options below.', 'success');
            }, 2000);
        } else {
            showStatus('❌ ' + result.message, 'error');
            installBtn.disabled = false;
            document.getElementById('pickPath').disabled = false;
        }
    } catch (err) {
        spinner.classList.remove('show');
        showStatus('❌ Installation failed: ' + err.message, 'error');
        installBtn.disabled = false;
        document.getElementById('pickPath').disabled = false;
    }
});

// Handle installation complete event from main process
ipcRenderer.on('installation-complete', (event, data) => {
    readmePath = data.readmePath;
    shinePath = data.shinePath;
});

document.getElementById('openReadme').addEventListener('click', async () => {
    if (!readmePath) return;
    
    try {
        const result = await ipcRenderer.invoke('open-readme', readmePath);
        if (!result.success) {
            showStatus('⚠️ Could not open README: ' + result.error, 'error');
        } else {
            showStatus('📖 Opening Getting Started Guide...', 'info');
            setTimeout(() => {
                showStatus('✅ Installation complete! You can close this window.', 'success');
            }, 2000);
        }
    } catch (err) {
        showStatus('⚠️ Could not open README: ' + err.message, 'error');
    }
});

document.getElementById('openFolder').addEventListener('click', async () => {
    if (!shinePath) return;
    
    try {
        const result = await ipcRenderer.invoke('open-folder', shinePath);
        if (!result.success) {
            showStatus('⚠️ Could not open folder: ' + result.error, 'error');
        } else {
            showStatus('📁 Opening installation folder...', 'info');
            setTimeout(() => {
                showStatus('✅ Installation complete! You can close this window.', 'success');
            }, 2000);
        }
    } catch (err) {
        showStatus('⚠️ Could not open folder: ' + err.message, 'error');
    }
});