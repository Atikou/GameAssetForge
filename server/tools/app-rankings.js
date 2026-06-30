const DEFAULT_LIMIT = 50;
const CACHE_TTL_MS = 15 * 60 * 1000;
const RRF_K = 60;
const GLOBAL_COUNTRY = "global";
const GLOBAL_CONCURRENCY = 6;

const cache = new Map();

const countryCodes = [
  "ad", "ae", "af", "ag", "ai", "al", "am", "ao", "ar", "at", "au", "az",
  "ba", "bb", "bd", "be", "bf", "bg", "bh", "bj", "bm", "bn", "bo", "br", "bs", "bt", "bw", "by", "bz",
  "ca", "cg", "ch", "ci", "cl", "cm", "cn", "co", "cr", "cv", "cy", "cz",
  "de", "dk", "dm", "do", "dz",
  "ec", "ee", "eg", "es",
  "fi", "fj", "fm", "fr",
  "gb", "gd", "gh", "gm", "gr", "gt", "gw", "gy",
  "hk", "hn", "hr", "hu",
  "id", "ie", "il", "in", "iq", "is", "it",
  "jm", "jo", "jp",
  "ke", "kg", "kh", "kn", "kr", "kw", "ky", "kz",
  "la", "lb", "lc", "lk", "lr", "lt", "lu", "lv",
  "md", "mg", "mk", "ml", "mn", "mo", "mr", "ms", "mt", "mu", "mv", "mw", "mx", "my", "mz",
  "na", "ne", "ng", "ni", "nl", "no", "np", "nz",
  "om",
  "pa", "pe", "pg", "ph", "pk", "pl", "pt", "pw", "py",
  "qa",
  "ro", "rs", "ru", "rw",
  "sa", "sb", "sc", "se", "sg", "si", "sk", "sl", "sn", "sr", "st", "sv", "sz",
  "tc", "td", "th", "tj", "tm", "tn", "tr", "tt", "tw", "tz",
  "ua", "ug", "us", "uy", "uz",
  "vc", "ve", "vg", "vn",
  "ye",
  "za", "zm", "zw",
];

const regionNames = new Intl.DisplayNames(["zh-Hans-CN"], { type: "region" });
const preferredCountryOrder = ["us", "cn", "jp", "kr", "gb", "de", "fr", "br", "in"];
const countries = countryCodes
  .map((code) => ({ code, label: regionNames.of(code.toUpperCase()) || code.toUpperCase() }))
  .sort((a, b) => {
    const preferredA = preferredCountryOrder.indexOf(a.code);
    const preferredB = preferredCountryOrder.indexOf(b.code);
    if (preferredA >= 0 || preferredB >= 0) {
      if (preferredA < 0) return 1;
      if (preferredB < 0) return -1;
      return preferredA - preferredB;
    }
    return a.label.localeCompare(b.label, "zh-Hans-CN");
  });

const chartTypes = {
  top_free: { label: "免费游戏榜", appBrainPath: "top_free", appleName: "FreeApplications" },
  top_new_free: { label: "新免费游戏榜", appBrainPath: "top_new_free", appleName: "" },
  top_grossing: { label: "畅销游戏榜", appBrainPath: "top_grossing", appleName: "" },
};

const sourceTypes = {
  overall: { label: "综合总榜" },
  appbrain: { label: "AppBrain" },
  apple: { label: "Apple 官方 App Store" },
};

function stripTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number.parseInt(number, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function attr(fragment, name) {
  const match = String(fragment || "").match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function cellsFromRow(rowHtml) {
  const cells = [];
  const regex = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let match;
  while ((match = regex.exec(rowHtml))) cells.push(match[1]);
  return cells;
}

function normalizeCountry(value) {
  const code = String(value || GLOBAL_COUNTRY).toLowerCase();
  if (["all", "world", GLOBAL_COUNTRY].includes(code)) return GLOBAL_COUNTRY;
  return countries.some((country) => country.code === code) ? code : "us";
}

function countryLabel(code) {
  if (code === GLOBAL_COUNTRY) return "全球";
  return countries.find((item) => item.code === code)?.label || code.toUpperCase();
}

function countryDisplay(code) {
  return code === GLOBAL_COUNTRY ? "GLOBAL" : code.toUpperCase();
}

function normalizeChart(value) {
  return chartTypes[value] ? value : "top_new_free";
}

function normalizeSource(value) {
  return sourceTypes[value] ? value : "appbrain";
}

function parseRankChange(cell) {
  const text = decodeHtml(stripTags(cell || ""));
  const value = Number.parseInt(text, 10) || 0;
  if (/caret-up/i.test(cell)) return { direction: "up", value };
  if (/caret-down/i.test(cell)) return { direction: "down", value };
  return { direction: "same", value: 0 };
}

function appBrainUrl(chart, country) {
  return `https://www.appbrain.com/stats/google-play-rankings/${chartTypes[chart].appBrainPath}/game/${country}`;
}

function appleChartUrl(chart, country, limit) {
  return `https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/charts?cc=${country}&g=6014&name=${chartTypes[chart].appleName}&limit=${limit}`;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function appleLookupUrl(ids, country) {
  return `https://itunes.apple.com/lookup?id=${ids.join(",")}&country=${country}`;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

function parseAppBrain(html, sourceInfo, limit) {
  const rows = [];
  const tbody = html.match(/<table[^>]+id=["']rankings-table["'][\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i)?.[1] || "";
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tbody)) && rows.length < limit) {
    const cells = cellsFromRow(rowMatch[1]);
    if (cells.length < 5) continue;

    const appLink = cells[3].match(/<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const href = appLink ? decodeHtml(appLink[1]) : "";
    const iconAlt = attr(cells[2], "alt");
    const rank = Number.parseInt(stripTags(cells[0]), 10);
    const name = appLink ? decodeHtml(stripTags(appLink[2])) : iconAlt.replace(/\s+icon$/i, "");
    const developerMatch = cells[3].match(/ranking-app-cell-creator[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i);
    const rankChange = parseRankChange(cells[1] || "");

    rows.push(markOfflineCandidate({
      id: `appbrain:${href.split("/").filter(Boolean).at(-1) || name}`,
      rank,
      rankChange,
      name,
      developer: developerMatch ? decodeHtml(stripTags(developerMatch[1])) : "",
      icon: attr(cells[2], "src"),
      rating: Number.parseFloat(stripTags(cells[4])) || null,
      downloads: cells[5] ? decodeHtml(stripTags(cells[5])) : "",
      recentDownloads: cells[6] ? decodeHtml(stripTags(cells[6])) : "",
      releaseDate: "",
      packageName: href.split("/").filter(Boolean).at(-1) || "",
      genres: [],
      platform: "Google Play",
      country: sourceInfo.country,
      source: "AppBrain",
      sourceKey: sourceInfo.key,
      sourceUrl: href ? new URL(href, "https://www.appbrain.com").toString() : sourceInfo.url,
    }));
  }
  return rows;
}

async function fetchAppBrainRanking({ chart, country, limit }) {
  const url = appBrainUrl(chart, country);
  const html = await fetchText(url);
  return {
    key: `appbrain:${chart}:${country}`,
    label: `AppBrain - ${countryLabel(country)} ${chartTypes[chart].label}`,
    source: "AppBrain",
    platform: "Google Play",
    country: country.toUpperCase(),
    url,
    items: parseAppBrain(html, { key: `appbrain:${chart}:${country}`, country: country.toUpperCase(), url }, limit),
  };
}

async function fetchAppleRanking({ chart, country, limit }) {
  if (!chartTypes[chart].appleName) {
    return {
      key: `apple:${chart}:${country}`,
      label: `Apple 官方 App Store - ${chartTypes[chart].label}`,
      source: "Apple App Store",
      platform: "iOS",
      country: country.toUpperCase(),
      url: "",
      items: [],
      warning: "Apple 当前只接入免费游戏榜。",
    };
  }

  const chartUrl = appleChartUrl(chart, country, limit);
  const chartData = await fetchJson(chartUrl);
  const ids = chartData.resultIds || [];
  if (!ids.length) return { key: `apple:${chart}:${country}`, source: "Apple App Store", country: country.toUpperCase(), url: chartUrl, items: [] };
  const lookupData = await fetchJson(appleLookupUrl(ids, country));
  const byId = new Map((lookupData.results || []).map((item) => [String(item.trackId), item]));
  const items = ids
    .map((id, index) => {
      const app = byId.get(String(id));
      if (!app) return null;
      return markOfflineCandidate({
        id: `apple:${id}`,
        rank: index + 1,
        rankChange: { direction: "unknown", value: 0 },
        name: app.trackName || app.trackCensoredName || "",
        developer: app.sellerName || app.artistName || "",
        icon: app.artworkUrl100 || app.artworkUrl60 || "",
        rating: Number(app.averageUserRating) || null,
        downloads: "",
        recentDownloads: "",
        releaseDate: app.releaseDate || "",
        packageName: app.bundleId || "",
        genres: app.genres || [],
        platform: "iOS",
        country: country.toUpperCase(),
        source: "Apple App Store",
        sourceKey: `apple:${chart}:${country}`,
        sourceUrl: app.trackViewUrl || chartUrl,
      });
    })
    .filter(Boolean);

  return {
    key: `apple:${chart}:${country}`,
    label: `Apple 官方 App Store - ${countryLabel(country)} ${chartTypes[chart].label}`,
    source: "Apple App Store",
    platform: "iOS",
    country: country.toUpperCase(),
    url: chartUrl,
    items,
  };
}

function normalizeGameKey(item) {
  const stableId = item.platform === "Google Play" && item.packageName ? item.packageName : "";
  return String(stableId || item.name || "")
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim();
}

function betterRankChange(existing, incoming) {
  if (!existing || existing.direction === "unknown" || existing.direction === "same") return incoming;
  return existing;
}

function mergeOverallRankings(rankings, limit) {
  const merged = new Map();
  for (const ranking of rankings) {
    for (const item of ranking.items || []) {
      const key = normalizeGameKey(item);
      if (!key) continue;
      const current = merged.get(key) || {
        ...item,
        rank: 0,
        rankChange: { direction: "unknown", value: 0 },
        overallScore: 0,
        sourceRanks: [],
        source: "综合总榜",
        sourceKey: "overall",
        platform: "多平台",
      };
      current.overallScore += 1 / (RRF_K + item.rank);
      current.sourceRanks.push({
        source: item.source,
        platform: item.platform,
        country: item.country,
        rank: item.rank,
        rankChange: item.rankChange,
      });
      if (!current.icon && item.icon) current.icon = item.icon;
      if (!current.rating && item.rating) current.rating = item.rating;
      if (!current.downloads && item.downloads) current.downloads = item.downloads;
      if (!current.recentDownloads && item.recentDownloads) current.recentDownloads = item.recentDownloads;
      if (!current.releaseDate && item.releaseDate) current.releaseDate = item.releaseDate;
      current.rankChange = betterRankChange(current.rankChange, item.rankChange);
      current.offlineCandidate = current.offlineCandidate || item.offlineCandidate;
      current.offlineReason = current.offlineReason || item.offlineReason;
      merged.set(key, current);
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.overallScore - a.overallScore || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      source: "综合总榜",
      sourceUrl: item.sourceUrl,
      downloads: item.downloads || "",
    }));
}

async function fetchGlobalAppBrainRanking({ chart, limit }) {
  const perCountryLimit = Math.max(limit, Math.min(50, limit * 2));
  const rankings = await mapWithConcurrency(countryCodes, GLOBAL_CONCURRENCY, (country) => {
    const fallback = {
      key: `appbrain:${chart}:${country}`,
      label: `AppBrain - ${countryLabel(country)} ${chartTypes[chart].label}`,
      source: "AppBrain",
      platform: "Google Play",
      country: countryDisplay(country),
      url: appBrainUrl(chart, country),
    };
    return captureRanking(() => fetchAppBrainRanking({ chart, country, limit: perCountryLimit }), fallback);
  });
  const successful = rankings.filter((ranking) => (ranking.items || []).length);
  const warnings = rankings.filter((ranking) => ranking.warning);
  const items = mergeOverallRankings(successful, limit);
  return {
    key: `appbrain:${chart}:${GLOBAL_COUNTRY}`,
    label: `AppBrain - 全球 ${chartTypes[chart].label}`,
    source: "AppBrain",
    platform: "Google Play",
    country: "GLOBAL",
    url: "",
    items,
    countryCount: countryCodes.length,
    successfulCountryCount: successful.length,
    warning: warnings.length ? `${warnings.length} 个国家/地区暂时不可用。` : "",
  };
}

async function fetchGlobalRankings({ source, chart, filter, limit }) {
  const rankings = [];
  if (source === "appbrain" || source === "overall") {
    rankings.push(await fetchGlobalAppBrainRanking({ chart, limit: limit * 2 }));
  }
  if (source === "apple") {
    rankings.push({
      key: `apple:${chart}:${GLOBAL_COUNTRY}`,
      label: `Apple 官方 App Store - 全球 ${chartTypes[chart].label}`,
      source: "Apple App Store",
      platform: "iOS",
      country: "GLOBAL",
      url: "",
      items: [],
      warning: "Apple 官方公开榜单接口必须指定国家/地区，当前全球模式不做 Apple 聚合。",
    });
  }

  const sourceItems = source === "appbrain"
    ? rankings.flatMap((ranking) => ranking.items || [])
    : mergeOverallRankings(rankings, limit * 2);
  const items = filterItems(sourceItems, filter).slice(0, limit);
  const data = {
    providerId: `${source}:${chart}:${GLOBAL_COUNTRY}`,
    source,
    chart,
    filter,
    country: "GLOBAL",
    label: `${sourceTypes[source].label} - 全球 ${chartTypes[chart].label}`,
    sourceUrl: rankings.map((ranking) => ranking.url).filter(Boolean).join(" | "),
    fetchedAt: new Date().toISOString(),
    cached: false,
    algorithm: { name: "跨国家 Reciprocal Rank Fusion", k: RRF_K, formula: "score += 1 / (k + rank)" },
    fields: {
      rank: true,
      rankChange: true,
      icon: true,
      name: true,
      rating: true,
      downloads: true,
      recentDownloads: chart !== "top_grossing",
      releaseDate: source !== "appbrain",
      offlineCandidate: true,
    },
    sources: rankings.map((ranking) => ({
      key: ranking.key,
      label: ranking.label,
      source: ranking.source,
      platform: ranking.platform,
      country: ranking.country,
      count: ranking.items?.length || 0,
      countryCount: ranking.countryCount,
      successfulCountryCount: ranking.successfulCountryCount,
      warning: ranking.warning,
      url: ranking.url,
    })),
    notes: [
      "全球榜不使用单一国家页面，而是抓取多个国家/地区榜单后用 RRF 融合，出现国家越多、排名越靠前的游戏得分越高。",
      "Google Play 来源使用 AppBrain 各国家/地区公开榜单融合；Apple 官方公开榜单没有全球端点，当前全球模式不聚合 Apple。",
      "单机筛选是基于名称、开发者和类型关键词的候选判断，不等同于商店官方标签。",
      ...rankings.filter((ranking) => ranking.warning).map((ranking) => `${ranking.source}: ${ranking.warning}`),
    ],
    items,
  };
  return data;
}

const offlineKeywords = [
  "offline",
  "single player",
  "single-player",
  "no wifi",
  "no wi-fi",
  "solitaire",
  "sudoku",
  "mahjong",
  "crossword",
  "word search",
  "jigsaw",
  "coloring",
  "sort",
  "block",
  "puzzle",
  "match",
  "hidden object",
  "find differences",
  "2048",
];

const onlineKeywords = [
  "multiplayer",
  "mmo",
  "battle royale",
  "pvp",
  "guild",
  "clash",
  "heroes",
  "football",
  "dragonfire",
  "realtime",
  "online",
];

function markOfflineCandidate(item) {
  const haystack = [item.name, item.developer, ...(item.genres || [])].join(" ").toLowerCase();
  const onlineHit = onlineKeywords.find((keyword) => haystack.includes(keyword));
  const offlineHit = offlineKeywords.find((keyword) => haystack.includes(keyword));
  return {
    ...item,
    offlineCandidate: Boolean(offlineHit && !onlineHit),
    offlineReason: offlineHit && !onlineHit ? `关键词: ${offlineHit}` : "",
  };
}

function filterItems(items, filter) {
  if (filter !== "offline") return items;
  return items.filter((item) => item.offlineCandidate);
}

async function captureRanking(fetcher, fallback) {
  try {
    return await fetcher();
  } catch (error) {
    return {
      ...fallback,
      items: [],
      warning: error.message,
    };
  }
}

async function fetchAppRankings(options = {}) {
  const source = normalizeSource(options.source || options.provider);
  const country = normalizeCountry(options.country);
  const chart = normalizeChart(options.chart);
  const filter = options.filter === "offline" ? "offline" : "all";
  const limit = Math.max(1, Math.min(100, Number(options.limit) || DEFAULT_LIMIT));
  const refresh = Boolean(options.refresh);
  const cacheKey = `${source}:${chart}:${country}:${filter}:${limit}`;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return { ...cached.data, cached: true };

  if (country === GLOBAL_COUNTRY) {
    const data = await fetchGlobalRankings({ source, chart, filter, limit });
    cache.set(cacheKey, { cachedAt: Date.now(), data });
    return data;
  }

  const rankings = [];
  if (source === "appbrain" || source === "overall") {
    const fallback = {
      key: `appbrain:${chart}:${country}`,
      label: `AppBrain - ${countryLabel(country)} ${chartTypes[chart].label}`,
      source: "AppBrain",
      platform: "Google Play",
      country: countryDisplay(country),
      url: appBrainUrl(chart, country),
    };
    const ranking = source === "overall"
      ? await captureRanking(() => fetchAppBrainRanking({ chart, country, limit }), fallback)
      : await fetchAppBrainRanking({ chart, country, limit });
    rankings.push(ranking);
  }
  if ((source === "apple" || source === "overall") && chartTypes[chart].appleName) {
    const fallback = {
      key: `apple:${chart}:${country}`,
      label: `Apple 官方 App Store - ${countryLabel(country)} ${chartTypes[chart].label}`,
      source: "Apple App Store",
      platform: "iOS",
      country: countryDisplay(country),
      url: appleChartUrl(chart, country, limit),
    };
    const ranking = source === "overall"
      ? await captureRanking(() => fetchAppleRanking({ chart, country, limit }), fallback)
      : await fetchAppleRanking({ chart, country, limit });
    rankings.push(ranking);
  }

  const sourceItems = source === "overall" ? mergeOverallRankings(rankings, limit * 2) : rankings.flatMap((ranking) => ranking.items || []);
  const items = filterItems(sourceItems, filter).slice(0, limit);
  const data = {
    providerId: `${source}:${chart}:${country}`,
    source,
    chart,
    filter,
    country: countryDisplay(country),
    label: `${sourceTypes[source].label} - ${countryLabel(country)} ${chartTypes[chart].label}`,
    sourceUrl: rankings.map((ranking) => ranking.url).filter(Boolean).join(" | "),
    fetchedAt: new Date().toISOString(),
    cached: false,
    algorithm: source === "overall" ? { name: "Reciprocal Rank Fusion", k: RRF_K, formula: "score += 1 / (k + rank)" } : null,
    fields: {
      rank: true,
      rankChange: true,
      icon: true,
      name: true,
      rating: true,
      downloads: true,
      recentDownloads: chart !== "top_grossing",
      releaseDate: source !== "appbrain",
      offlineCandidate: true,
    },
    sources: rankings.map((ranking) => ({
      key: ranking.key,
      label: ranking.label,
      source: ranking.source,
      platform: ranking.platform,
      country: ranking.country,
      count: ranking.items?.length || 0,
      warning: ranking.warning,
      url: ranking.url,
    })),
    notes: [
      "AppBrain 公开榜单页提供排名、排名变化、图标、名称、评分、安装量区间和部分榜单的近 30 日安装量。",
      "Apple 官方榜单通过 iTunes chart + lookup 补充名称、图标、评分和首次 releaseDate，但没有下载量和排名变化。",
      "单机筛选是基于名称、开发者和类型关键词的候选判断，不等同于商店官方标签。",
      "综合总榜使用 Reciprocal Rank Fusion 融合多个来源，缺席某来源的游戏不会被直接淘汰。",
      ...rankings.filter((ranking) => ranking.warning).map((ranking) => `${ranking.source} 暂时不可用: ${ranking.warning}`),
    ],
    items,
  };
  cache.set(cacheKey, { cachedAt: Date.now(), data });
  return data;
}

function getRankingProviders() {
  return {
    sources: Object.entries(sourceTypes).map(([id, source]) => ({ id, ...source })),
    charts: Object.entries(chartTypes).map(([id, chart]) => ({ id, label: chart.label, appleAvailable: Boolean(chart.appleName) })),
    countries: [{ code: GLOBAL_COUNTRY, label: "全球" }, ...countries],
    filters: [
      { id: "all", label: "全部游戏" },
      { id: "offline", label: "可能单机/离线" },
    ],
  };
}

module.exports = {
  fetchAppRankings,
  getRankingProviders,
};
