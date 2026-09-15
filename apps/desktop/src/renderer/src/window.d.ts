declare global {
  interface Window {
    api: {
      platform: NodeJS.Platform
      versions: {
        electron: string
        chrome: string
        node: string
      }
    }
  }
}

export {}
