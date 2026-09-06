declare global {
  interface Window {
    api: {
      versions: {
        electron: string
        chrome: string
        node: string
      }
    }
  }
}

export {}
