import { requestMainWorld } from "@/lib/yt/requestMainWorld"

// Channel tabs whose video list can be copied, e.g. `/@handle/videos`.
export const channelTabPattern =
  /^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/(?:videos|shorts|streams)\/?$/

type ChannelItem = {
  title: string
  url: string
  details: string[]
}

// YouTube text fields come as `{ content }`, `{ simpleText }` or `{ runs }`.
const text = (t: any): string =>
  (
    t?.content ??
    t?.simpleText ??
    t?.runs?.map((r: any) => r.text).join("") ??
    ""
  ).trim()

// Collects every thumbnail badge (duration, "LIVE", "UPCOMING", ...) under
// `node`, wherever the current layout nests them.
const badgeTexts = (node: any): string[] => {
  const found: string[] = []
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return
    if (n.thumbnailBadgeViewModel) {
      const t =
        text(n.thumbnailBadgeViewModel) || n.thumbnailBadgeViewModel.text
      if (t) found.push(t.trim())
    }
    for (const v of Object.values(n)) walk(v)
  }
  walk(node)
  return found
}

// View counts are shown with only a play icon (e.g. "21만"), so label them.
const metadataParts = (contentMetadataViewModel: any): string[] =>
  (contentMetadataViewModel?.metadataRows ?? []).flatMap((row: any) =>
    (row.metadataParts ?? [])
      .map((p: any) => {
        const t = text(p.text)
        return t && p.leadingIcon?.name?.startsWith("PLAY_ARROW")
          ? `${t} views`
          : t
      })
      .filter(Boolean),
  )

const watchUrl = (videoId: string) =>
  `https://www.youtube.com/watch?v=${videoId}`
const shortsUrl = (videoId: string) =>
  `https://www.youtube.com/shorts/${videoId}`

const parseItem = (content: any): ChannelItem | null => {
  // Videos and live streams
  const lockup = content.lockupViewModel
  if (lockup?.contentId) {
    const meta = lockup.metadata?.lockupMetadataViewModel
    return {
      title: text(meta?.title),
      url: watchUrl(lockup.contentId),
      details: [
        ...badgeTexts(lockup.contentImage),
        ...metadataParts(meta?.metadata?.contentMetadataViewModel),
      ],
    }
  }

  // Shorts
  const shorts = content.shortsLockupViewModel
  if (shorts) {
    const videoId =
      shorts.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ??
      shorts.entityId?.replace(/^shorts-shelf-item-/, "")
    if (!videoId) return null
    return {
      title: text(shorts.overlayMetadata?.primaryText),
      url: shortsUrl(videoId),
      details: [text(shorts.overlayMetadata?.secondaryText)].filter(Boolean),
    }
  }

  // Older layouts
  const video = content.videoRenderer ?? content.gridVideoRenderer
  if (video?.videoId) {
    return {
      title: text(video.title),
      url: watchUrl(video.videoId),
      details: [
        text(video.lengthText),
        text(video.viewCountText),
        text(video.publishedTimeText),
      ].filter(Boolean),
    }
  }

  const reel = content.reelItemRenderer
  if (reel?.videoId) {
    return {
      title: text(reel.headline),
      url: shortsUrl(reel.videoId),
      details: [text(reel.viewCountText)].filter(Boolean),
    }
  }

  return null
}

const escapeLinkText = (s: string) => s.replace(/([[\]\\])/g, "\\$1")

const toHttps = (url?: string) => url?.replace(/^http:\/\//, "https://")

export const getChannelMarkdown = async () => {
  const data = await requestMainWorld<any>(
    "GET_YT_CHANNEL_DATA",
    "YT_CHANNEL_DATA",
    {},
    2000,
  )
  if (!data?.tab) return null

  const channel = data.metadata?.channelMetadataRenderer ?? {}
  const header = data.header?.pageHeaderRenderer?.content?.pageHeaderViewModel
  const profile =
    data.microformat?.microformatDataRenderer?.channelProfileMicroformatDetails
      ?.profilePage?.mainEntity

  const grid = data.tab.content?.richGridRenderer
  const contents: any[] = grid?.contents ?? []
  const items = contents
    .map((c) => c.richItemRenderer?.content ?? c)
    .map(parseItem)
    .filter((item): item is ChannelItem => Boolean(item?.title))
  const hasMore = contents.some((c) => c.continuationItemRenderer)

  const name = channel.title || text(header?.title?.dynamicTextViewModel?.text)
  const channelUrl = toHttps(channel.vanityChannelUrl || channel.channelUrl)
  const stats = metadataParts(header?.metadata?.contentMetadataViewModel)
  const sort = grid?.header?.chipBarViewModel?.chips
    ?.map((c: any) => c.chipViewModel)
    .find((c: any) => c?.selected)?.text
  const links: string[] = profile?.sameAs ?? []
  const description: string = channel.description?.trim() ?? ""

  const info = [
    channelUrl && `- Channel: [${escapeLinkText(name)}](${channelUrl})`,
    channel.externalId && `- Channel ID: ${channel.externalId}`,
    stats.length > 0 && `- ${stats.join(" · ")}`,
    sort && `- Sort: ${sort}`,
    links.length > 0 && `- Links: ${links.join(", ")}`,
    channel.keywords && `- Keywords: ${channel.keywords}`,
    channel.rssUrl && `- RSS: ${channel.rssUrl}`,
  ].filter(Boolean)

  const list = items.map(
    (item, i) =>
      `${i + 1}. [${escapeLinkText(item.title)}](${item.url})` +
      item.details.map((d) => ` · ${d}`).join(""),
  )

  const tabTitle: string = data.tab.title ?? ""

  return [
    `# ${name} - ${tabTitle}`,
    info.join("\n"),
    description &&
      description
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    `## ${tabTitle} (${items.length})`,
    hasMore &&
      `_Only the ${items.length} items loaded on the page are included. Scroll down to load more._`,
    list.join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n")
}
