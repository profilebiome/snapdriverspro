'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('dup', {
  bootstrap: () => call('app:bootstrap'),
  startScan: () => call('scan:start'),
  cancelScan: () => call('scan:cancel'),
  onScanEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('scan:event', listener);
    return () => ipcRenderer.removeListener('scan:event', listener);
  },

  verifyRows: (rowKeys, verified) => call('verdict:verify', { rowKeys, verified }),
  probeVersion: (rowKey) => call('verdict:probe', { rowKey }),

  openLink: (rowKey, which) => call('links:open', { rowKey, which }),
  openLinks: (rowKeys, which) => call('links:openMany', { rowKeys, which }),

  pickPackage: () => call('installer:pick'),
  pickFolder: () => call('installer:pickFolder'),
  install: (target, restorePoint) => call('installer:run', { target, restorePoint }),
  installBatch: (targets, restorePoint) => call('installer:runBatch', { targets, restorePoint }),
  isElevated: () => call('app:isElevated'),
  relaunchElevated: () => call('app:relaunchElevated'),
  savePending: (payload) => call('pending:save', payload),
  takePending: () => call('pending:take'),
  openDeviceManager: () => call('installer:deviceManager'),

  exportReport: (format) => call('report:export', { format }),
  saveSettings: (patch) => call('settings:save', patch),
  getCatalog: () => call('catalog:get'),
  saveCatalog: (entries) => call('catalog:save', entries),
  openCatalogFolder: () => call('catalog:openFolder'),
  openReportsFolder: () => call('data:openFolder'),
  getUpdatesInfo: () => call('updates:info'),
  checkUpdates: () => call('updates:check'),
  downloadUpdate: () => call('updates:download'),
  installUpdate: () => call('updates:install'),
  onUpdateEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('update:event', listener);
    return () => ipcRenderer.removeListener('update:event', listener);
  },

  getLogs: (limit, level) => call('logs:tail', { limit, level }),
  clearLogs: () => call('logs:clear'),
  openLogsFolder: () => call('logs:openFolder'),
  exportLogs: (format) => call('logs:export', { format }),

  openWindowsUpdate: () => call('app:windowsUpdate'),

  searchDownloads: (rowKey) => call('downloads:search', { rowKey }),
  startDownload: (payload) => call('downloads:start', payload),
  extractDownload: (cabPath) => call('downloads:extract', { cabPath }),
  cancelDownload: (jobId) => call('downloads:cancel', { jobId }),
  openDownloadsFolder: () => call('downloads:openFolder'),
  onDownloadEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('scan:event', listener);
    return () => ipcRenderer.removeListener('scan:event', listener);
  },
  about: () => call('dialog:about'),

  windowControl: (action) => call('window:controls', action),
});
