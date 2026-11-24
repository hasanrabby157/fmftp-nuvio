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

function fmtSize(bytes) {
  bytes = Number(bytes);
  if (!bytes || bytes < 1) return "";
  var gb = bytes / 1073741824;
  if (gb >= 1) return gb.toFixed(2).replace(/\.?0+$/, "") + "GB";
  return Math.round(bytes / 1048576) + "MB";
}

async function probeSize(url) {
  try {
    var r = await fetch(url, { headers: { Range: "bytes=0-0" } });
    var cr = (r.headers && r.headers.get && r.headers.get("content-range")) || "";
    var m = cr.match(/\/(\d+)\s*$/);
    return m ? fmtSize(Number(m[1])) : "";
  } catch (e) {
    return "";
  }
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
  var found = [];
  var re = /href=["'](https?:\/\/[^"']*discoveryftp\.net[^"']*\.(?:mkv|mp4|m3u8|avi|webm))["']/gi;
  var m;
  while ((m = re.exec(text)) !== null) found.push(m[1]);
  if (!found.length) {
    var re2 = /https?:\/\/[a-z0-9.-]*discoveryftp\.net\/[^"'\s<>#\\]+?\.(?:mkv|mp4|m3u8|avi|webm)/gi;
    while ((m = re2.exec(text)) !== null) found.push(m[0]);
  }
  var seen = {};
  return found
    .map(function (u) { return decodeHtml(u).replace(/ /g, "%20"); })
    .filter(function (u) {
      if (/poster|\/media\/|images\d*\./i.test(u)) return false;
      if (seen[u]) return false;
      seen[u] = true;
      return true;
    });
}

function parseInfo(text) {
  var tags = [];
  [
    [/blu-?ray|bdrip|brrip/i, "BluRay"],
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
      var list = await searchSite(tries[i]);
      hits = list.filter(function (r) {
        if (!same(r.title, title)) return false;
        if (!year || !r.year) return true;
        return Math.abs(Number(r.year) - year) <= 1;
      });
    }
    if (!hits.length) return [];

    var results = await Promise.all(hits.map(async function (r) {
      try {
        var vRes = await fetch(SITE + "/m/view/" + r.id);
        var html = await vRes.text();
        var text = html;
        var lm = html.match(new RegExp("lazyload/" + r.id + "/(\\d+)"));
        if (lm) {
          try {
            var lRes = await fetch(SITE + "/m/lazyload/" + r.id + "/" + lm[1]);
            text += "\n" + (await lRes.text());
          } catch (e) {}
        }
        var links = extractLinks(text);
        var streams = [];

        if (links.length) {
          for (var k = 0; k < links.length; k++) {
            var u = links[k];
            var file = safeDecode(u.split("?")[0].split("/").pop());
            var info = parseInfo(file + " " + r.quality);
            var d = [];
            if (info.q) d.push(info.q);
            d = d.concat(info.tags);
            var size = await probeSize(u);
            if (size) d.push(size);
            var ext = file.indexOf(".") >= 0 ? file.split(".").pop().toUpperCase() : "";
            if (ext && ext.length <= 4) d.push(ext);
            if (r.category) d.push(r.category);
            streams.push({
              name: "DFTP • " + d.join(" • "),
              title: r.title + " (" + r.year + ")\n" + file,
              url: u,
              quality: info.q || "Unknown"
            });
          }
        } else {
          var info2 = parseInfo(r.quality);
          var d2 = [];
          if (info2.q) d2.push(info2.q);
          d2 = d2.concat(info2.tags);
          d2.push("HLS");
          if (r.category) d2.push(r.category);
          streams.push({
            name: "DFTP • " + d2.join(" • "),
            title: r.title + " (" + r.year + ")",
            url: SITE + "/m/playlist/" + r.id,
            quality: info2.q || "Unknown"
          });
        }
        return streams;
      } catch (e) {
        return [];
      }
    }));

    return results.reduce(function (a, b) { return a.concat(b); }, []);
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams: getStreams };
