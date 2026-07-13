import path from "node:path";
import { projectRoot } from "../config.js";
import { getDomain, normalizeHandle, readJson } from "../utils.js";

export async function loadAuthorityRegistry(config) {
  const registryPath = path.resolve(projectRoot, config.authorityRegistryPath || "config/authority-registry.json");
  return readJson(registryPath, { version: 1 });
}

export function matchAuthority(item, registry) {
  if (item.platform === "youtube") return matchYoutube(item, registry.youtube || {});
  if (item.platform === "x") return matchX(item, registry.x || {});
  if (item.platform === "bilibili") return matchBilibili(item, registry.bilibili || {});
  return matchWeb(item, registry.web || {});
}

function result(level, score, matchedBy, requiresReview = false) {
  return { level, score, matchedBy, requiresReview };
}

function matchYoutube(item, registry) {
  const handle = normalizeHandle(item.handle);
  const channelId = String(item.channelId || "").toLowerCase();
  const name = String(item.sourceName || item.author || "").toLowerCase();
  const official = findChannel(item, registry.officialChannels || [], handle, channelId, name);
  if (official) return result("official", 100, official);
  const authoritative = findChannel(item, registry.authoritativeChannels || [], handle, channelId, name);
  if (authoritative) return result("authoritative", 85, authoritative);
  const highSignal = findChannel(item, registry.highSignalCreators || [], handle, channelId, name);
  if (highSignal) return result("high-signal", 60, highSignal, true);
  return result("unverified", 20, "no-youtube-registry-match", true);
}

function findChannel(item, entries, handle, channelId, name) {
  for (const entry of entries) {
    if (entry.channelId && channelId && entry.channelId.toLowerCase() === channelId) {
      return `channelId:${entry.channelId}`;
    }
    if (entry.handle && handle && normalizeHandle(entry.handle) === handle) {
      return `handle:${entry.handle}`;
    }
    if (entry.name && name && entry.name.toLowerCase() === name) {
      return `name:${entry.name}`;
    }
  }
  return "";
}

function matchX(item, registry) {
  const handle = normalizeHandle(item.handle || item.author || item.sourceName);
  const official = (registry.officialAccounts || []).find((entry) => normalizeHandle(entry.handle) === handle);
  if (official) return result("official", 100, `handle:${official.handle}`);
  const authoritative = (registry.authoritativeAccounts || []).find((entry) => normalizeHandle(entry.handle) === handle);
  if (authoritative) return result("authoritative", 85, `handle:${authoritative.handle}`);
  const highSignal = (registry.highSignalAccounts || []).find((entry) => normalizeHandle(entry.handle) === handle);
  if (highSignal) return result("high-signal", 60, `handle:${highSignal.handle}`, true);
  return result("unverified", 20, "no-x-registry-match", true);
}

function matchBilibili(item, registry) {
  const name = String(item.sourceName || item.author || "").toLowerCase();
  const title = String(item.title || "").toLowerCase();
  const official = findNamedSource(registry.officialChannels || [], name, title, false);
  if (official) return result("official", 90, `name:${official.name}`);
  const authoritative = findNamedSource(registry.authoritativeChannels || [], name, title, true);
  if (authoritative) return result("authoritative", 75, `name:${authoritative.name}`);
  const highSignal = findNamedSource(registry.highSignalCreators || [], name, title, true);
  if (highSignal) return result("high-signal", 55, `name:${highSignal.name}`, true);
  return result("community-signal", 35, "bilibili-video-unmatched", true);
}

function findNamedSource(entries, name, title, allowTitleMarker) {
  return entries.find((entry) => {
    const entryName = String(entry.name || "").toLowerCase();
    if (!entryName) return false;
    if (name === entryName) return true;
    if (!allowTitleMarker) return false;
    return title.startsWith(entryName) || title.includes(`【${entryName}】`) || title.includes(`[${entryName}]`);
  });
}

function matchWeb(item, registry) {
  const domain = getDomain(item.url);
  if (!domain) return result("unverified", 10, "missing-domain", true);
  if (matchesDomain(domain, registry.officialDomains || [])) {
    return result("official", 95, `domain:${domain}`);
  }
  if (matchesDomain(domain, registry.authoritativeDomains || [])) {
    return result("authoritative", 80, `domain:${domain}`);
  }
  const communitySource = findCommunitySource(item, registry.communitySources || [], domain);
  if (communitySource) {
    return result("community-signal", 35, `community:${communitySource.name || communitySource.domain}`, true);
  }
  return result("known-source", 45, `domain:${domain}`, true);
}

function matchesDomain(domain, domains) {
  return domains.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

function findCommunitySource(item, sources, domain) {
  const communityName = String(item.metrics?.communitySource || item.sourceName || "").toLowerCase();
  for (const source of sources) {
    if (source.name && communityName && source.name.toLowerCase() === communityName) return source;
    if (!source.domain || !matchesDomain(domain, [source.domain])) continue;
    if (matchesSourcePath(item.url, source.url)) return source;
  }
  return null;
}

function matchesSourcePath(itemUrl, sourceUrl) {
  if (!sourceUrl) return true;
  try {
    const item = new URL(itemUrl);
    const source = new URL(sourceUrl);
    if (item.hostname.replace(/^www\./i, "").toLowerCase() !== source.hostname.replace(/^www\./i, "").toLowerCase()) {
      return false;
    }
    return source.pathname === "/" || item.pathname.startsWith(source.pathname);
  } catch {
    return true;
  }
}
