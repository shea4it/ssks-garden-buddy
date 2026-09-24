'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (event, payload) => fn(payload));

contextBridge.exposeInMainWorld('app', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (next) => ipcRenderer.invoke('settings:set', next),

  getRules: () => ipcRenderer.invoke('alerts:rules'),
  getStatus: () => ipcRenderer.invoke('alerts:status'),
  checkNow: () => ipcRenderer.invoke('alerts:checkNow'),
  onAlerts: on('alerts:play'),
  onStatus: on('alerts:status'),

  getHistory: () => ipcRenderer.invoke('alerts:history'),
  clearHistory: () => ipcRenderer.invoke('alerts:clearHistory'),
  onHistory: on('alerts:history'),
  onSnooze: on('alerts:snooze'),
  onAutoHatch: on('pity:autoHatch'),

  onTab: on('control:tab'),
  onHatch: on('pity:hatch'),

  panel: (change) => ipcRenderer.invoke('ui:panel', change || null),
  onPanel: on('ui:panel'),

  fun: (name) => ipcRenderer.invoke('fun:play', name),
  worthGet: () => ipcRenderer.invoke('worth:get'),
  reclaimGet: () => ipcRenderer.invoke('reclaim:get'),
  reclaimSet: (change) => ipcRenderer.invoke('reclaim:set', change),
  reclaimAct: (act) => ipcRenderer.invoke('reclaim:act', act),
  onReclaim: on('reclaim:state'),
  onSecret: on('secret:rainbow'),
  harvestGet: () => ipcRenderer.invoke('harvest:get'),
  harvestSet: (change) => ipcRenderer.invoke('harvest:set', change),
  onHarvestLock: on('harvest:lock'),
  onHarvestBlocked: on('harvest:blocked'),
  seedsDelete: (species, count) => ipcRenderer.invoke('seeds:delete', species, count),
  seedsStop: () => ipcRenderer.invoke('seeds:stop'),
  onSeedRun: on('seeds:run'),
  backupSave: (testPath) => ipcRenderer.invoke('backup:save', testPath),
  backupRestore: (testPath) => ipcRenderer.invoke('backup:restore', testPath),
  backupFolder: () => ipcRenderer.invoke('backup:folder'),

  luckGet: () => ipcRenderer.invoke('luck:get'),
  luckSet: (key, value) => ipcRenderer.invoke('luck:set', key, value),
  luckOptions: (opts) => ipcRenderer.invoke('luck:options', opts),
  onLuck: on('luck:state'),
  getPity: () => ipcRenderer.invoke('pity:get'),
  pityAct: (action) => ipcRenderer.invoke('pity:act', action),
  onPity: on('pity:state'),

  roomsRefresh: () => ipcRenderer.invoke('rooms:refresh'),
  roomsSave: (id, name) => ipcRenderer.invoke('rooms:save', id, name),
  roomsRemove: (id) => ipcRenderer.invoke('rooms:remove', id),
  roomsShowShared: (on) => ipcRenderer.invoke('rooms:showShared', on),
  roomsClipboardSetting: (on) => ipcRenderer.invoke('rooms:clipboardSetting', on),
  onRoomClipboard: on('rooms:clipboard'),
  checkClipboard: () => ipcRenderer.invoke('rooms:checkClipboard'),
  roomsJoin: (id) => ipcRenderer.invoke('rooms:join', id),

  getGarden: () => ipcRenderer.invoke('garden:get'),
  setStrength: (petId, strength) => ipcRenderer.invoke('garden:strength', petId, strength),
  resetGarden: (key) => ipcRenderer.invoke('garden:reset', key || null),
  gardenSample: () => ipcRenderer.invoke('garden:sample'),
  onGardenStatus: on('garden:status'),
  onGardenStats: on('garden:stats'),

  speechRoutingSupported: () => ipcRenderer.invoke('tts:supported'),
  warmSpeech: () => ipcRenderer.invoke('tts:warm'),
  synthesize: (req) => ipcRenderer.invoke('tts:synthesize', req),

  voicesList: () => ipcRenderer.invoke('voices:list'),
  voiceDownload: (id) => ipcRenderer.invoke('voices:download', id),
  voiceRemove: (id) => ipcRenderer.invoke('voices:remove', id),
  voiceWarm: (id) => ipcRenderer.invoke('voices:warm', id),
  voiceSynthesize: (id, text, speaker) => ipcRenderer.invoke('voices:synthesize', id, text, speaker),
  onVoiceProgress: on('voices:progress'),

  listScripts: () => ipcRenderer.invoke('scripts:list'),
  toggleScript: (name, enabled) => ipcRenderer.invoke('scripts:toggle', name, enabled),
  runScripts: () => ipcRenderer.invoke('scripts:run'),
  openScriptsFolder: () => ipcRenderer.invoke('scripts:openFolder'),

  version: () => ipcRenderer.invoke('app:version'),
  weatherKinds: () => ipcRenderer.invoke('weather:kinds'),
  applyTeam: (teamId) => ipcRenderer.invoke('teams:apply', teamId),
  getParked: () => ipcRenderer.invoke('game:parked'),
  logoffNow: () => ipcRenderer.invoke('game:logoffNow'),
  rejoin: () => ipcRenderer.invoke('game:rejoin'),
  onParked: on('game:parked'),

  reloadGame: () => ipcRenderer.invoke('game:reload'),
  gameConsole: () => ipcRenderer.invoke('game:devtools'),
  focusGame: () => ipcRenderer.invoke('game:focus'),
  keysToGame: () => ipcRenderer.invoke('game:keys'),
});
