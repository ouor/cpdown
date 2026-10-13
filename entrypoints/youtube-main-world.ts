export default defineUnlistedScript(() => {
  // This script runs in the main world and can access the YouTube player.

  // PO tokens (`pot`) are bound to a video ID: a token captured from a
  // pre-roll ad or a previously watched video makes the timedtext API return
  // an empty body. Keep them per video.
  const potByVideoId = new Map<string, string>()

  const capturePot = (url: string) => {
    if (!url.includes("/api/timedtext")) return

    try {
      const { searchParams } = new URL(url, location.href)
      const videoId = searchParams.get("v")
      const pot = searchParams.get("pot")
      if (videoId && pot) {
        potByVideoId.set(videoId, pot)
      }
    } catch (error) {
      console.error("Error parsing timedtext URL:", error)
    }
  }

  // Intercept XHR and fetch requests to capture the pot parameter from the
  // timedtext API.
  const originalOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ) {
    capturePot(String(url))

    return originalOpen.call(
      this,
      method,
      url,
      async ?? true,
      username,
      password,
    )
  }

  const originalFetch = window.fetch
  window.fetch = function (input, init) {
    capturePot(input instanceof Request ? input.url : String(input))
    return originalFetch.call(this, input, init)
  }

  // Requests made before this script was injected are still visible through
  // the Resource Timing API.
  const findPot = (videoId: string) => {
    const pot = potByVideoId.get(videoId)
    if (pot) return pot

    for (const entry of performance.getEntriesByType("resource")) {
      capturePot(entry.name)
    }

    return potByVideoId.get(videoId) ?? ""
  }

  const getPlayer = () => document.getElementById("movie_player") as any

  // `window.ytInitialPlayerResponse` is only set on the initial page load and
  // goes stale after in-app (SPA) navigation, so prefer the live player.
  const getPlayerResponse = (videoId: string) => {
    const candidates = [
      getPlayer()?.getPlayerResponse?.(),
      (window as any).ytInitialPlayerResponse,
    ]

    return candidates.find((r) => r?.videoDetails?.videoId === videoId) ?? null
  }

  const getPot = async (videoId: string) => {
    let pot = findPot(videoId)
    if (pot) return pot

    // Toggle captions twice (restoring the user's state) so the player
    // requests the timedtext API with a fresh pot. The request is sent
    // asynchronously, so wait for it to show up.
    const subtitleButton = document.querySelector<HTMLButtonElement>(
      "button.ytp-subtitles-button",
    )
    if (!subtitleButton) return ""

    subtitleButton.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    subtitleButton.click()

    const deadline = Date.now() + 3000
    while (!pot && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      pot = findPot(videoId)
    }

    return pot
  }

  // Listen for messages from the content script
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return

    if (event.data.type === "GET_YT_INITIAL_PLAYER_RESPONSE") {
      window.postMessage(
        {
          type: "YT_INITIAL_PLAYER_RESPONSE",
          data: getPlayerResponse(event.data.videoId),
          requestId: event.data.requestId,
        },
        "*",
      )
    }

    if (event.data.type === "GET_YT_POT") {
      let pot = ""
      try {
        pot = await getPot(event.data.videoId)
      } catch (error) {
        console.error("Error capturing pot:", error)
      }

      window.postMessage(
        {
          type: "YT_POT",
          data: pot,
          requestId: event.data.requestId,
        },
        "*",
      )
    }

    if (event.data.type === "GET_YT_CAPTIONS_SELECTION") {
      // Read the currently displayed caption track from the YouTube player.
      // Returns `{}` when captions are off; we normalize that to `null`.
      let selected: {
        vssId?: string
        languageCode?: string
        kind?: string
        baseUrl?: string
      } | null = null

      try {
        const player = getPlayer()
        if (player && typeof player.getOption === "function") {
          const track = player.getOption("captions", "track")
          if (
            track &&
            typeof track === "object" &&
            Object.keys(track).length > 0
          ) {
            selected = {
              // Newer players expose the ID as `vss_id`.
              vssId: track.vssId ?? track.vss_id,
              languageCode: track.languageCode,
              kind: track.kind,
              baseUrl: track.baseUrl,
            }
          }
        }
      } catch (error) {
        console.error("Error reading selected caption track:", error)
      }

      window.postMessage(
        {
          type: "YT_CAPTIONS_SELECTION",
          data: selected,
          requestId: event.data.requestId,
        },
        "*",
      )
    }
  })

  console.log("YouTube main world script loaded")
})
