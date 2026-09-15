import { contextBridge } from 'electron'

const api = {
  // The renderer reserves the traffic-light band only where main asked for a
  // hidden title bar, so it needs the same value main branched on.
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
}

contextBridge.exposeInMainWorld('api', api)
