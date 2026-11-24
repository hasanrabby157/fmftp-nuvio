// FMFTP provider for Nuvio Local Scrapers (movies only). Works on BDIX connections.
// Put your free TMDB API key below (themoviedb.org -> Settings -> API).
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
    var info = await tmdbRes.json();
    var title = info.title || info.original_title;
    if (!title) return [];
    var year = (info.release_date || "").slice(0, 4);

    var searchRes = await fetch(SITE + "/api/search?search=" + encodeURIComponent(title));
    var list = await searchRes.json();
    if (!Array.isArray(list)) return [];

    var seen = {};
    var hits = list.filter(function (m) {
      var ok =
        String(m.tmdb_id) === String(tmdbId) ||
        ((m.title || "").toLowerCase() === title.toLowerCase() && String(m.year) === year);
      if (!ok || seen[m.id]) return false;
      seen[m.id] = true;
      return true;
    });

    return hits.map(function (m) {
      var q = getQuality(m.file_path);
      return {
        name: "FMFTP",
        title: m.title + " (" + m.year + ")",
        url: SITE + "/api/stream/video/stream?type=movies&id=" + m.id,
        quality: q
      };
    });
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams: getStreams };
