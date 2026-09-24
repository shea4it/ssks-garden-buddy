'use strict';

// The only thing the game page can reach: a one-way line to the app for the
// garden observer's reports. Nothing from the app or your computer is
// exposed to the page.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mgLoaderBridge', {
  send: (type, payload) => ipcRenderer.send('garden:msg', { type: String(type), payload }),
});
