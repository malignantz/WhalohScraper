var express = require("express");
var bodyParser = require("body-parser");
var http = require("http");
var request = require("request");
var axios = require("axios");
var cheerio = require("cheerio");
var sleep = require("sleep");
var fs = require("fs");

let app = express();
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// init memory db

const DB = {
  figures: [
    // id, name, ability, primaryType, secondaryType, attacks, movement, rarity, version, image
  ],
  plates: {}
};

function getFigure(id) {
  //console.log(typeof id === typeof DB.figures[0].id);
  //console.log(DB.figures);
  return DB.figures.find(fig => id === fig.id);
}

function setFigure(figure) {
  //  console.log("30" + JSON.stringify(figure));
  Object.assign(DB.figures.find(fig => fig.id === figure.id), figure);
}

function addFigure(opts) {
  const {
    id,
    name,
    ability,
    primaryType,
    secondaryType,
    attacks,
    movement,
    rarity,
    version,
    image
  } = opts;

  DB.figures.push({
    id,
    name,
    ability,
    primaryType,
    secondaryType,
    attacks,
    movement,
    rarity,
    version,
    image
  });
}

// end init mem db

// CONFIG

// helper fns
function flatMap(arr) {
  return arr.reduce((flatArr, item) => flatArr.concat(item), []);
}

function trimBoth(s) {
  s = s.trim();
  s = s.trimLeft();
  return s;
}

function urlizeName(name) {
  if (name === undefined) {
    console.error("Sad face");
  } else {
    return name
      .toLowerCase()
      .split(" ")
      .join("-");
  }
}

// ======================================
// Begin Scrapin'
// ======================================
const URLS = { figures: "https://www.serebii.net/duel/figures.shtml" };

function getListOfFigures() {
  var figures = [];
  let addFig = figOptions => {
    const { name, id } = figOptions;
    figures.push({ name, id });
  };
  return get$FromURL(URLS.figures).then($ => {
    const names = [];
    const ids = [];
    const pokemons = [];

    $("td.fooinfo a u ").each(function(i, elem) {
      names.push($(this).text());
    });

    $("table.dextable tbody tr td.cen").each(function(z, el) {
      var text = $(el).text();
      if (text.includes("ID")) {
        var id = trimBoth(text.split("-").slice(-1)[0]);
        if (isFinite(parseInt(id))) {
          //console.log(id, names[z / 4]);
          addFig({ id, name: names[z / 4] });
          //console.log(figures.length);
        }
      }
    });
    //    console.log(ids);
    DB.figures = figures;
    return figures;
  });
}

function figureIdToURL(id) {
  const base = "https://www.serebii.net/duel/figures/";
  let name = DB.figures
    .find(fig => fig.id === id)
    .name.split(" ")
    .join("")
    .toLowerCase()
    .replace("♂", "m");
  let result = `${base}${id}-${name}.shtml`;
  //console.log(result);
  return result;
}

function get$FromURL(url) {
  console.log("128url", url);
  return axios.get(url).then(data => {
    //console.log("130" + JSON.stringify(data.data));
    var x = cheerio.load(data.data);
    return x;
  });
}

function scrapeById(id) {
  let url = figureIdToURL(id);
  return get$FromURL(url)
    .then($ => {
      let figure = parseFigure($);
      setFigure(figure);
      return figure;
    })
    .then(x => {
      console.log("Imported " + x.name);
    });
}

function throttleCall(fnArray, ms, cb) {
  let x = setInterval(() => {
    if (fnArray.length === 0) {
      clearInterval(x);
      cb.end("Finished Import.");
    } else {
      fnArray.pop()();
    }
  }, ms);
}

function scrapeAllFigures(cb) {
  let promArray = [];
  let fetchArray = [];
  let count = 50;

  let ids = DB.figures.map(fig => fig.id);
  for (var id of ids) {
    if (!DB.figures.find(f => f.id).rarity) {
      fetchArray.push(scrapeById.bind(this, id));
    }
  }

  throttleCall(fetchArray, 180, cb);
}

function parseFigure($) {
  const RARE_TYPES = {
    ux: true,
    uc: true,
    r: true,
    ex: true,
    c: true
  };

  const VALID_STATS = {
    type: val => !isFinite(parseInt(val)) && val.length > 1,
    rarity: val => RARE_TYPES[val],
    movement: val => isFinite(parseInt(val)),
    id: val => isFinite(parseInt(val)),
    ability: val => true,
    version: val => val.includes("V") && val.includes("."),
    image: val => val.includes("http")
  };

  let name = $("td.fooleft font b").text();
  name = name
    .split(" ")
    .filter(chunk => !chunk.includes("-") || !chunk.includes("ID-"))
    .join(" ")
    .replace("-", "");
  let id = $("td tr font b")
    .text()
    .split(" ")
    .filter(chunk => chunk.includes("ID-"))[0]
    .split("-")
    .filter(chunk => isFinite(parseInt(chunk)))[0];

  let statsPara = $("tr td.fooinfo p")
    .text()
    .split("\n");

  let stats = statsPara.reduce((stats, desc) => {
    if (desc && desc.includes(":")) {
      let [stat, val] = desc.split(":");
      let opts = {};
      stat = trimBoth(stat.toLowerCase());
      val = trimBoth(val.toLowerCase());

      // 'special ability' -> 'ability
      stat = stat.includes("ability") ? "ability" : stat;
      //console.log("stat,val:", stat, val);

      // check for secondaryType
      if (stat === "type" && val.includes("/")) {
        let [primaryType, secondaryType] = val.split("/");
        primaryType = trimBoth(primaryType);
        secondaryType = trimBoth(secondaryType);
        Object.assign(stats, { primaryType, secondaryType });
        //console.log("\n******\n****\n", ".", primaryType, ".", secondaryType);
      } else {
        if (VALID_STATS[stat] && VALID_STATS[stat](val)) {
          stats[stat] = val;
        } else {
          console.log("\n\n\nInvalid Stat error.\n\n\n");
          console.log("Stat:" + stat + "|", "Val:" + val, "|");
        }
      }
    }
    return { name, id, ...stats };
  }, {});

  // version && image still needed
  //console.log("219", stats);
  return stats;
}

function initDb() {
  return getListOfFigures().then(figs =>
    Object.assign(
      {},
      {
        success: Array.isArray(figs) && figs.length > 3 && !!figs[10].id,
        records: figs.length
      }
    )
  );
}

// ======================================
// Begin ExpressJS Server / Endpoints
// ======================================

// use '/scrape' to scrape all orgs/users and fill database
// takes about 90s -- once completed, /stats will show summary

// /orgs & /users work only after /scrape

app.get("/", (req, res) => {
  initDb().then(result => {
    const { success, records } = result;
    if (success) {
      res.end("Successfully scraped" + records);
    } else {
      res.end("error");
    }
  });
});

app.get("/figure/:figureId", (req, res) => {
  if (!DB.figures || DB.figures.length === 0) {
    initDb().then(opts => res.end("DB init success: " + String(opts.success)));
  } else {
    let id = req.params.figureId;
    let error = !isFinite(parseInt(id));
    if (error) res.end("error");

    var result = getFigure(id);
    //console.log(result);
    if (!error && result.id) {
      res.end("Name: " + result.name + "_ID: " + result.id);
    } else {
      res.end("error");
    }
  }
});

app.get("/figure/scrape/:id", (req, res) => {
  scrapeById(req.params.id).then(figure => {
    res.end(JSON.stringify(figure));
  });
});

app.get("/scrapeAllFigures", (req, res) => {
  scrapeAllFigures(res);
});

app.get("/dump", (req, res) => {
  res.send(JSON.stringify(DB));
  res.end();
});

app.listen(3000, () => {
  console.log("Listening on port 3000...");
});
