// CTGMovies provider for Nuvio Local Scrapers (movies + series). Works on BDIX connections.
var TMDB_KEY = "10d2fc3b3aabcd9b135b95f4b6529580";
var API = "https://cockpit.ctgmovies.com/api/v1";

function same(a, b) {
  var x = String(a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  var y = String(b || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return x !== "" && x === y;
}

function pad(n) {
  n = Number(n);
  return n < 10 ? "0" + n : String(n);
}

function fmtSize(bytes) {
  bytes = Number(bytes);
  if (!bytes || bytes < 1) return "";
  var gb = bytes / 1073741824;
  if (gb >= 1) return gb.toFixed(2).replace(/\.?0+$/, "") + "GB";
  return Math.round(bytes / 1048576) + "MB";
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

async function getJson(url) {
  var r = await fetch(url);
  return await r.json();
}

async function findItems(title, tmdbId, year, isTv) {
  var tries = [title];
  var noApos = title.replace(/['’`"]/g, "");
  if (noApos !== title) tries.push(noApos);
  var words = noApos
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort(function (a, b) { return b.length - a.length; });
  if (words[0] && tries.indexOf(words[0]) < 0) tries.push(words[0]);

  for (var i = 0; i < tries.length; i++) {
    var res = await getJson(API + "/movies?search=" + encodeURIComponent(tries[i]) + "&limit=50");
    var list = (res && res.movies) || [];
    var hits = list.filter(function (m) {
      if (!!m.is_tv_show !== isTv) return false;
      if (String(m.tmdb_id) === String(tmdbId)) return true;
      var nm = m.name || m.title;
      if (!same(nm, title)) return false;
      return isTv ? true : String(m.year) === String(year);
    });
    if (hits.length) return hits;
  }
  return [];
}

function parseInfo(text) {
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
    [/esub/i, "ESub"],
    [/atmos/i, "Atmos"],
    [/5\.1/, "5.1"]
  ].forEach(function (t) {
    if (t[0].test(text) && tags.indexOf(t[1]) < 0) tags.push(t[1]);
  });
  var q = text.match(/(2160|1080|720|480)p/i);
  return { q: q ? q[1] + "p" : "", tags: tags };
}

function linksToStreams(links, heading, prefix, fallbackLang) {
  var out = [];
  for (var j = 0; j < (links || []).length; j++) {
    var l = links[j];
    if (!l || l.broken) continue;
    var urls = [];
    if (l.url) urls.push({ u: l.url, hls: false });
    if (l.hls_url) urls.push({ u: l.hls_url, hls: true });

    for (var k = 0; k < urls.length; k++) {
      var u = urls[k];
      var file = safeDecode(u.u.split("?")[0].split("/").pop());
      var info = parseInfo(file + " " + (l.quality || ""));
      var d = [];
      if (info.q) d.push(info.q);
      d = d.concat(info.tags);
      var size = fmtSize(l.size_bytes);
      if (size) d.push(size);
      var ext = file.indexOf(".") >= 0 ? file.split(".").pop().toUpperCase() : "";
      if (u.hls) d.push("HLS");
      else if (ext && ext.length <= 4) d.push(ext);
      var lang = l.language || fallbackLang;
      if (lang) d.push(lang);
      out.push({
        name: "CTG • " + (prefix ? prefix + " • " : "") + d.join(" • "),
        title: heading + "\n" + file,
        url: u.u,
        quality: info.q || "Unknown"
      });
    }
  }
  return out;
}

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    var isTv = mediaType === "tv" || mediaType === "series";
    if (mediaType !== "movie" && !isTv) return [];

    var tm = await getJson(
      "https://api.themoviedb.org/3/" + (isTv ? "tv" : "movie") + "/" + tmdbId + "?api_key=" + TMDB_KEY
    );
    var title = isTv ? (tm.name || tm.original_name) : (tm.title || tm.original_title);
    if (!title) return [];
    var dateStr = isTv ? tm.first_air_date : tm.release_date;
    var year = (dateStr || "").slice(0, 4);

    var hits = await findItems(title, tmdbId, year, isTv);
    var out = [];

    for (var i = 0; i < hits.length; i++) {
      var m = hits[i];

      if (!isTv) {
        var detail = await getJson(API + "/movies/" + m.id);
        var heading = (m.title || title) + " (" + (m.year || year) + ")";
        out = out.concat(linksToStreams(detail.links, heading, "", detail.language));
      } else {
        var show = await getJson(API + "/tv/" + m.id);
        var eps = show.episodes || [];
        var ep = eps.filter(function (e) {
          return Number(e.season_number) === Number(season) &&
                 Number(e.episode_number) === Number(episode);
        })[0];
        if (!ep) continue;
        var tag = "S" + pad(season) + "E" + pad(episode);
        var h2 = (m.name || m.title || title) + " " + tag + (ep.name ? " - " + ep.name : "");
        out = out.concat(linksToStreams(ep.links, h2, tag, show.language));
      }
    }
    return out;
  } catch (e) {
    return [];
  }
}

module.exports = { getStreams: getStreams };
