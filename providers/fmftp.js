// FMFTP provider for Nuvio Local Scrapers (movies only). Works on BDIX connections.
var TMDB_KEY = "10d2fc3b3aabcd9b135b95f4b6529580";
var SITE = "https://fmftp.net";

function getQuality(path) {
  var m = String(path || "").match(/(2160|1080|720|480)p/i);
  return m ? m[1] + "p" : "Unknown";
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (mediaType !== "movie") return [];

    var tmdbRes = await fetch(
      "https://api.themoviedb.org/3/movie/" + tmdbId + "?api_key=" + TMDB_KEY
    );
    var tm = await tmdbRes.json();
    var title = tm.title || tm.original_title;
    if (!title) return [];
    var year = (tm.release_date || "").slice(0, 4);

    var searchRes = await fetch(SITE + "/api/search?search=" + encodeURIComponent(title));
    var list = await searchRes.json();
    if (!Array.isArray(list)) return [];

    var seen = {};
    var hits = list.filter(function (m) {
      if (m.type && m.type !== "movie") return false;
      var ok =
        String(m.tmdb_id) === String(tmdbId) ||
        ((m.title || "").toLowerCase() === title.toLowerCase() && String(m.year) === year);
      if (!ok || seen[m.id]) return false;
      seen[m.id] = true;
      return true;
    });

    return hits.map(function (m) {
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
      return {
        name: "FMFTP • " + details.join(" • "),
        title: m.title + " (" + m.year + ")\n" + details.join(" • ") + "\n" + file,
        url: SITE + "/api/stream/video/stream?type=movies&id=" + m.id,
        quality: q
      };
    });
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams: getStreams };
