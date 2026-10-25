'use strict';

// The only thing the game page can reach: a one-way line to the app for the
// garden observer's reports. Nothing from the app or your computer is
// exposed to the page.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mgLoaderBridge', {
  send: (type, payload) => ipcRenderer.send('garden:msg', { type: String(type), payload }),
  // The stepped-away page's "Reconnect when the weather ends" (v0.60.5):
  // one yes / no, only honoured from that page while you're stepped away.
  parkedReconnect: (on) => ipcRenderer.send('parked:reconnect', on === true),
});
