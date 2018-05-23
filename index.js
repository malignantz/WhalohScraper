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

// *********************************
//        UTILS                   |******************************************************************
// *********************************

function flatMap(arr) {
  return arr.reduce((flatArr, item) => flatArr.concat(item), []);
}

function trimBoth(s) {
  if (typeof s !== "string") {
    //  console.error("25_Illegal trim on S. S is a ", typeof s);
    return s;
  }
  s = s.trim();
  s = s.trimLeft();
  return s;
}
function get$FromURL(url) {
  return axios.get(url).then(data => {
    //console.log("130" + JSON.stringify(data.data));
    var x = cheerio.load(data.data);
    return x;
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

const DB = {
  figures: [
    // id, name, ability, primaryType, secondaryType, attacks, movement, rarity, version, image
  ],
  plates: [],
  attacks: {}
};
const URLS = { figures: "https://www.serebii.net/duel/figures.shtml" };
// *********************************
//        FIGURES                   |******************************************************************
// *********************************

function getFigure(id) {
  //console.log(typeof id === typeof DB.figures[0].id);
  //console.log(DB.figures);
  return DB.figures.find(fig => id === fig.id);
}

function setFigure(figure) {
  //  console.log("30" + JSON.stringify(figure));
  Object.assign(DB.figures.find(fig => fig.id === figure.id), figure);
}
/*
function addFigure(opts) {
  const {
    id,
    name,
    ability,
    primaryType,
    secondaryType,
    attacks,
    movement,
    rarity
    //version,
    //image
  } = opts;

  DB.figures.push({
    id,
    name,
    ability,
    primaryType,
    secondaryType,
    attacks,
    movement,
    rarity
    // version,
    //image
  });
}
*/
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

function scrapeById(id) {
  let url = figureIdToURL(id);
  return get$FromURL(url)
    .then($ => {
      let figure = parseFigure($);
      console.log("Scraping ID:", figure.id);
      setFigure(trimFigure(figure));
      return figure;
    })
    .then(x => {
      //console.log("154_Imported " + JSON.stringify(x));
    });
}

function trimFigure(fig) {
  let result = Object.assign({}, fig);
  for (var key in result) {
    //    console.log(key, result);
    if (key !== "attacks") {
    }
    result[key] = trimBoth(result[key]);
  }
  return result;
}

function scrapeAllFigures(cb) {
  console.log("168-scrapeAllFigures");
  let promArray = [];
  let fetchArray = [];

  let ids = DB.figures.map(fig => fig.id);
  for (var id of ids) {
    if (!DB.figures.find(f => f.id).rarity) {
      fetchArray.push(scrapeById.bind(this, id));
    }
  }

  throttleCall(fetchArray, 220, cb);
}

function parseFigure($) {
  // console.log("184-parseFigure");
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
  // get name prop
  let name = $("td.fooleft font b").text();
  name = name
    .split(" ")
    .filter(chunk => !chunk.includes("-") || !chunk.includes("ID-"))
    .join(" ")
    .replace("-", "");
  // get ID prop
  let id = $("td tr font b")
    .text()
    .split(" ")
    .filter(chunk => chunk.includes("ID-"))[0]
    .split("-")
    .filter(chunk => isFinite(parseInt(chunk)))[0];

  let statsPara = $("tr td.fooinfo p")
    .text()
    .split("\n");

  // this is movement, rarity, type, special ability
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
      if (val.includes("/") && stat === "type") {
        let [primaryType, secondaryType] = val.split("/");
        primaryType = trimBoth(primaryType);
        secondaryType = trimBoth(secondaryType);
        Object.assign(stats, { primaryType, secondaryType });
      } else {
        // change type to primaryType if only one type
        if (VALID_STATS[stat] && VALID_STATS[stat](val)) {
          if (stat === "type") {
            stats.primaryType = val;
            stats.secondaryType = "";
          }
          stat = stat === "type" ? "primaryType" : stat;
          // sets the stat
          stats[stat] = val;
        } else {
          console.log("\n\n\nInvalid Stat error.\n\n\n");
          console.log("Stat:" + stat + "|", "Val:" + val, "|");
        }
      }
    }
    return { name, id, ...stats };
  }, {});

  //  console.log("256" + JSON.stringify(stats));
  // trick out stats and then return it

  var test = $("#moves  table.dextable tr").text();
  /*
  console.log(
    test.length,
    typeof test,
    test
      .split("\n")
      .map(item => item.trim().trimLeft())
      .slice(8)
  );
  */
  //console.log("272");

  // version & image

  let version = $("li.tabs").attr("title");
  let image = `https://www.serebii.net/duel/figures/${id}.jpg`;

  // attacks

  let moves = test
    .split("\n")
    .map(item => item.trim().trimLeft())
    .slice(8);
  let moveArray = [];
  for (var i = 0; i < moves.length - 5; i++) {
    let windowData = moves.slice(i, i + 5);
    //console.log("280wData-", windowData);
    if (isFinite(parseInt(windowData[0])) && !!windowData[1]) {
      let data = windowData;
      moveArray.push({
        wheelsize: data[0],
        name: data[1],
        color: data[2],
        damage: data[4],
        version,
        notes: data[3]
      });

      // feed attacks straight into DB

      if (!DB.attacks[data[1]]) {
        DB.attacks[data[1]] = {
          wheelsize: data[0],
          color: data[2],
          notes: data[3],
          damage: data[4]
        };
      }
      // console.log("290" + JSON.stringify(stats));
    }
  }

  return { version, image, ...stats };
}

function figuresTSV() {
  let header =
    Object.keys(DB.figures[0])
      .filter(x => x !== "attacks")
      .join(",") + "\n";

  return DB.figures.reduce((tsv, item) => {
    for (var prop in item) {
      let d = item[prop];
      tsv += d + "\t";
    }
    return tsv.slice(0, -1) + "\n";
  }, "");
}

// this is broken...weird output.

function attacksTSV() {
  let header = "name\t" + Object.keys(DB.attacks.Dodge).join("\t") + "\n";

  let attacks = Object.keys(DB.attacks); // attacks = [wheelsize, color, notes, damage]

  return attacks.reduce(
    (tsv, attackName) =>
      tsv +
      `${attackName}\t${Object.values(DB.attacks[attackName]).join("\t")}\n`,
    header
  );
}
function makeTSVData(key) {
  // doesn't include moves

  //let useProps = Object.keys(DB[key][0])

  // ITEM ISN'T FILTERED SO WE ARE GETTING ATTACKS WHEN WE DON'T WANT THEM

  const TSV_FNS = {
    figures: figuresTSV,
    attacks: attacksTSV
  };

  return TSV_FNS[key] ? TSV_FNS[key]() : console.log("345-incorrect itemType");
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
      res.end(JSON.stringify(result));
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

app.get("/dump/:cat", (req, res) => {
  let itemType = req.params.cat ? req.params.cat : "figures";

  res.send(JSON.stringify(DB[itemType]));
  res.end();
  fs.writeFileSync(`${itemType}.tsv`, makeTSVData(itemType));
});

app.get("/vers", (req, res) => {
  get$FromURL("https://www.serebii.net/duel/figures/1-dialga.shtml").then($ => {
    res.end();
  });
});

app.listen(3000, () => {
  console.log("Listening on port 3000...");
});
