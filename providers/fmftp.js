// FMFTP provider for Nuvio Local Scrapers (movies + series). Works on BDIX connections.
var TMDB_KEY = "10d2fc3b3aabcd9b135b95f4b6529580";
var SITE = "https://fmftp.net";

function getQuality(path) {
  var m = String(path || "").match(/(2160|1080|720|480)p/i);
  return m ? m[1] + "p" : "Unknown";
}

function pad(n) {
  n = Number(n);
  return n < 10 ? "0" + n : String(n);
}

function same(a, b) {
  var x = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  var y = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return x !== "" && x === y;
}

function fmtSize(bytes) {
  if (!bytes || bytes < 1) return "";
  var gb = bytes / 1073741824;
  if (gb >= 1) return gb.toFixed(2).replace(/\.?0+$/, "") + "GB";
  return Math.round(bytes / 1048576) + "MB";
}

async function searchSite(title) {
  var clean = String(title || "")
    .replace(/['’`"]/g, "")
    .replace(/[:;,!?&()\[\]\\%*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return [];
  var res = await fetch(SITE + "/api/search?search=" + encodeURIComponent(clean));
  var list = await res.json();
  return Array.isArray(list) ? list : [];
}

// Ask the video server for size / type / file name (reads headers only)
async function probe(url) {
  var info = { size: "", type: "", file: "" };
  try {
    var r = await fetch(url, { headers: { Range: "bytes=0-0" } });
    var h = r.headers;
    var get = function (k) {
      try { return (h && h.get && h.get(k)) || ""; } catch (e) { return ""; }
    };
    var mm = get("content-range").match(/\/(\d+)\s*$/);
    if (mm) info.size = fmtSize(Number(mm[1]));
    var ct = get("content-type").toLowerCase();
    if (ct.indexOf("matroska") >= 0) info.type = "MKV";
    else if (ct.indexOf("mp4") >= 0) info.type = "MP4";
    else if (ct.indexOf("msvideo") >= 0) info.type = "AVI";
    else if (ct.indexOf("webm") >= 0) info.type = "WEBM";
    var fm = get("content-disposition").match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (fm) {
      try { info.file = decodeURIComponent(fm[1]); } catch (e) { info.file = fm[1]; }
    }
  } catch (e) {}
  return info;
}

function parseFile(file) {
  file = String(file || "");
  var q = getQuality(file);
  var tags = [];
  [
    [/blu-?ray|bdrip|brrip/i, "BluRay"],
    [/web-?dl/i, "WEB-DL"],
    [/webrip/i, "WEBRip"],
    [/hdrip/i, "HDRip"],
    [/dvdrip/i, "DVDRip"],
    [/hdcam|camrip|\bcam\b/i, "CAM"],
    [/x265|hevc/i, "HEVC"],
    [/x264|h\.?264/i, "x264"],
    [/10bit/i, "10-bit"],
    [/hdr/i, "HDR"],
    [/dual|hin(di)?[ ._-]?(eng|dub)/i, "Dual Audio"],
    [/atmos/i, "Atmos"],
    [/5\.1/, "5.1"]
  ].forEach(function (t) {
    if (t[0].test(file) && tags.indexOf(t[1]) < 0) tags.push(t[1]);
  });
  var ext = file.indexOf(".") >= 0 ? file.split(".").pop().toUpperCase() : "";
  if (ext.length > 4) ext = "";
  var sz = file.match(/(\d+(?:\.\d+)?)\s?(GB|MB)/i);
  return { q: q, tags: tags, ext: ext, size: sz ? sz[1] + sz[2].toUpperCase() : "" };
}

function buildDetails(file, pr, lib) {
  var f = parseFile(file);
  var d = [];
  if (f.q !== "Unknown") d.push(f.q);
  d = d.concat(f.tags);
  var size = f.size || (pr && pr.size) || "";
  if (size) d.push(size);
  var type = f.ext || (pr && pr.type) || "";
  if (type) d.push(type);
  if (lib) d.push(lib);
  return { q: f.q, list: d };
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    var isTv = mediaType === "tv" || mediaType === "series";
    if (mediaType !== "movie" && !isTv) return [];

    var tmdbRes = await fetch(
      "https://api.themoviedb.org/3/" + (isTv ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_KEY
    );
    var tm = await tmdbRes.json();
    var title = isTv ? (tm.name || tm.original_name) : (tm.title || tm.original_title);
    if (!title) return [];
    var dateStr = isTv ? tm.first_air_date : tm.release_date;
    var year = (dateStr || "").slice(0, 4);

    var list = await searchSite(title);

    // ---------- MOVIES ----------
    if (!isTv) {
      var seen = {};
      var hits = list.filter(function (m) {
        if (!m.file_path) return false;
        if (m.type && m.type !== "movie") return false;
        var ok =
          String(m.tmdb_id) === String(tmdbId) ||
          (same(m.title, title) && String(m.year) === year);
        if (!ok || seen[m.id]) return false;
        seen[m.id] = true;
        return true;
      });

      return await Promise.all(hits.map(async function (m) {
        var url = SITE + "/api/stream/video/stream?type=movies&id=" + m.id;
        var file = String(m.file_path).split("/").pop();
        var pr = await probe(url);
        var lib = m.Library && m.Library.name ? m.Library.name : "";
        var d = buildDetails(file, pr, lib);
        var label = d.list.join(" • ");
        return {
          name: "FMFTP" + (label ? " • " + label : ""),
          title: m.title + " (" + m.year + ")\n" + file,
          url: url,
          quality: d.q
        };
      }));
    }

    // ---------- TV SERIES ----------
    var shows = list.filter(function (s) {
      return !s.file_path && s.path && String(s.tmdb_id) === String(tmdbId);
    });
    if (shows.length === 0) {
      shows = list.filter(function (s) {
        return !s.file_path && s.path && same(s.title, title);
      });
    }

    var out = [];
    var tag = "S" + pad(season) + "E" + pad(episode);
    for (var i = 0; i < shows.length; i++) {
      var s = shows[i];
      var detRes = await fetch(SITE + "/api/tv-shows/" + s.id + "?fields=episodes");
      var det = await detRes.json();
      var eps = det.episodes || [];
      var ep = eps.filter(function (e) {
        return Number(e.season_number) === Number(season) &&
               Number(e.episode_number) === Number(episode);
      })[0];
      if (!ep) continue;
      var lib2 = det.Library && det.Library.name ? det.Library.name : "";
      var epUrl = SITE + "/api/stream/video/stream?type=tv_shows&id=" + ep.id;
      var pr2 = await probe(epUrl);
      var d2 = buildDetails(pr2.file, pr2, lib2);
      var label2 = d2.list.join(" • ");
      out.push({
        name: "FMFTP • " + tag + (label2 ? " • " + label2 : ""),
        title: s.title + " " + tag + (ep.name ? " - " + ep.name : "") + (pr2.file ? "\n" + pr2.file : ""),
        url: epUrl,
        quality: d2.q
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams: getStreams };
