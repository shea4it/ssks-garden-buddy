'use strict';

// The account tab bar (tabs.html, v0.55.0): its state, and switching or
// closing the second account. Nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabs', {
  onState: (cb) => ipcRenderer.on('accounts:state', (event, st) => cb(st)),
  get: () => ipcRenderer.invoke('accounts:get'),
  show: (n) => ipcRenderer.send('accounts:show', n),
  close: () => ipcRenderer.invoke('accounts:remove'),
});
