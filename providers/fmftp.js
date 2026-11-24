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

function movieDetails(m) {
  var path = String(m.file_path || "");
  var file = path.split("/").pop();
  var ext = (file.split(".").pop() || "").toUpperCase();
  var q = getQuality(path);
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
  var details = [q].concat(tags);
  var sz = file.match(/(\d+(?:\.\d+)?)\s?(GB|MB)/i);
  if (sz) details.push(sz[1] + sz[2].toUpperCase());
  if (ext) details.push(ext);
  if (m.Library && m.Library.name) details.push(m.Library.name);
  return { q: q, details: details, file: file };
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

      return hits.map(function (m) {
        var d = movieDetails(m);
        return {
          name: "FMFTP • " + d.details.join(" • "),
          title: m.title + " (" + m.year + ")\n" + d.details.join(" • ") + "\n" + d.file,
          url: SITE + "/api/stream/video/stream?type=movies&id=" + m.id,
          quality: d.q
        };
      });
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
      var lib = det.Library && det.Library.name ? det.Library.name : "";
      out.push({
        name: "FMFTP • " + tag + (lib ? " • " + lib : ""),
        title: s.title + " " + tag + (ep.name ? " - " + ep.name : "") + (lib ? "\n" + lib : ""),
        url: SITE + "/api/stream/video/stream?type=tv_shows&id=" + ep.id,
        quality: "Unknown"
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams: getStreams };
