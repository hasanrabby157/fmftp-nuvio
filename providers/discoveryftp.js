// DiscoveryFTP provider for Nuvio Local Scrapers (movies only). Works on BDIX connections.
var TMDB_KEY = "10d2fc3b3aabcd9b135b95f4b6529580";
var SITE = "https://movies.discoveryftp.net";

function same(a, b) {
  var x = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  var y = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return x !== "" && x === y;
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

// Gives up after ms milliseconds and returns fallback instead
function withTimeout(p, ms, fallback) {
  return new Promise(function (resolve) {
    var done = false;
    var t = null;
    function finish(v) {
      if (done) return;
      done = true;
      if (t && typeof clearTimeout === "function") clearTimeout(t);
      resolve(v);
    }
    if (typeof setTimeout === "function") {
      t = setTimeout(function () { finish(fallback); }, ms);
    }
    p.then(finish, function () { finish(fallback); });
  });
}

async function getText(url) {
  var r = await fetch(url);
  return await r.text();
}

async function searchSite(term) {
  var res = await fetch(SITE + "/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: "term=" + encodeURIComponent(term) + "&types=m"
  });
  var html = await res.text();
  var chunks = html.split("moviesearchiteam").slice(1);
  var out = [];
  chunks.forEach(function (c) {
    var id = c.match(/\/m\/view\/(\d+)/);
    var t = c.match(/class="searchtitle"\s*>([^<]*)</);
    var y = c.match(/Year\s*:\s*(\d{4})/);
    var cat = c.match(/Category:\s*([^<]+)/);
    var q = c.match(/Quality:\s*([^<]+)/);
    if (id && t) {
      out.push({
        id: id[1],
        title: decodeHtml(t[1].trim()),
        year: y ? y[1] : "",
        category: cat ? cat[1].trim() : "",
        quality: q ? q[1].replace(/\s+/g, " ").trim() : ""
      });
    }
  });
  return out;
}

function extractLinks(text) {
  text = String(text || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  var found = [];
  var re = /https?:\/\/[a-z0-9.-]*discoveryftp\.net\/[^"'<>#\\]+?\.(?:mkv|mp4|m3u8|avi|webm)(?=["'\s<>#?)]|$)/gi;
  var m;
  while ((m = re.exec(text)) !== null) found.push(m[0]);
  var seen = {};
  return found
    .map(function (u) { return decodeHtml(u).replace(/ /g, "%20"); })
    .filter(function (u) {
      if (/\/\/images\d*\./i.test(u) || /poster|\/media\//i.test(u)) return false;
      if (seen[u]) return false;
      seen[u] = true;
      return true;
    });
}

function parseInfo(text) {
  var tags = [];
  [
    [/blu-?ray|bdrip|brrip|720p-br/i, "BluRay"],
    [/web-?dl/i, "WEB-DL"],
    [/web-?r\b|webrip/i, "WEBRip"],
    [/hdrip/i, "HDRip"],
    [/dvdrip/i, "DVDRip"],
    [/hdcam|camrip|\bcam\b/i, "CAM"],
    [/x265|hevc/i, "HEVC"],
    [/x264|h\.?264/i, "x264"],
    [/10bit/i, "10-bit"],
    [/hdr/i, "HDR"],
    [/dual|multi/i, "Dual Audio"],
    [/esub/i, "ESub"],
    [/atmos/i, "Atmos"],
    [/ddp?5\.1|5\.1/i, "5.1"]
  ].forEach(function (t) {
    if (t[0].test(text) && tags.indexOf(t[1]) < 0) tags.push(t[1]);
  });
  var q = text.match(/(2160|1080|720|480)p/i);
  var res = q ? q[1] + "p" : (/4k|uhd/i.test(text) ? "4K" : "");
  return { q: res, tags: tags };
}

async function buildFromResult(r) {
  try {
    var html = await withTimeout(getText(SITE + "/m/view/" + r.id), 8000, "");
    var links = extractLinks(html);
    var sm = html.match(/badge-fill">[^<|]*\|\s*([\d.]+)\s*(GB|MB)/i);
    var size = sm ? sm[1] + sm[2].toUpperCase() : "";

    if (links.length) {
      return links.map(function (u) {
        var file = safeDecode(u.split("?")[0].split("/").pop());
        var info = parseInfo(file + " " + r.quality);
        var d = [];
        if (info.q) d.push(info.q);
        d = d.concat(info.tags);
        if (size) d.push(size);
        var ext = file.indexOf(".") >= 0 ? file.split(".").pop().toUpperCase() : "";
        if (ext && ext.length <= 4) d.push(ext);
        if (r.category) d.push(r.category);
        return {
  name: "DEBUG • " + file,
  title: "URL: " + u,
  url: u,
  quality: info.q || "Unknown"
});
    }
  } catch (e) {}

  // Fallback: the site's stream playlist
  var info2 = parseInfo(r.quality);
  var d2 = [];
  if (info2.q) d2.push(info2.q);
  d2 = d2.concat(info2.tags);
  d2.push("Stream");
  if (r.category) d2.push(r.category);
  return [{
    name: "DFTP • " + d2.join(" • "),
    title: r.title + " (" + r.year + ")",
    url: SITE + "/m/playlist/" + r.id,
    quality: info2.q || "Unknown"
  }];
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (mediaType !== "movie") return [];

    var tmRes = await fetch(
      "https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + TMDB_KEY
    );
    var tm = await tmRes.json();
    var title = tm.title || tm.original_title;
    if (!title) return [];
    var year = Number((tm.release_date || "").slice(0, 4)) || 0;

    var clean = title.replace(/['’`"]/g, "").replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    var tries = [clean];
    var words = clean.split(" ").filter(Boolean).sort(function (a, b) { return b.length - a.length; });
    if (words[0] && words[0] !== clean) tries.push(words[0]);

    var hits = [];
    for (var i = 0; i < tries.length && hits.length === 0; i++) {
      var list = await withTimeout(searchSite(tries[i]), 8000, []);
      hits = list.filter(function (r) {
        if (!same(r.title, title)) return false;
        if (!year || !r.year) return true;
        return Math.abs(Number(r.year) - year) <= 1;
      });
    }
    if (!hits.length) return [];

    var results = await Promise.all(hits.map(buildFromResult));
    return results.reduce(function (a, b) { return a.concat(b); }, []);
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams: getStreams };
