const { ipcRenderer } = require('electron');

let installPath = null;

document.getElementById('pickPath').addEventListener('click', async () => {
    installPath = await ipcRenderer.invoke('select-path');
    document.getElementById('pathDisplay').innerText = installPath || 'No folder selected';
});

document.getElementById('install').addEventListener('click', async () => {
    if (!installPath) return alert('Please select a folder first!');
    document.getElementById('status').innerText = 'Installing... ✨';
    const result = await ipcRenderer.invoke('install-shine', installPath);
    document.getElementById('status').innerText = result.message;
});
