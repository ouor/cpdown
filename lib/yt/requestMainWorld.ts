// Sends a request to the YouTube main-world script and resolves with its
// response, or `null` when it does not answer within `timeout` ms.
export const requestMainWorld = <T>(
  type: string,
  responseType: string,
  payload: Record<string, unknown>,
  timeout: number,
): Promise<T | null> => {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).substring(7)

    // Listen for response from main world script
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window) return

      if (
        event.data.type === responseType &&
        event.data.requestId === requestId
      ) {
        window.removeEventListener("message", handleMessage)
        resolve(event.data.data ?? null)
      }
    }

    window.addEventListener("message", handleMessage)

    // Request data from main world script
    window.postMessage({ ...payload, type, requestId }, "*")

    // Timeout if no response
    setTimeout(() => {
      window.removeEventListener("message", handleMessage)
      resolve(null)
    }, timeout)
  })
}
