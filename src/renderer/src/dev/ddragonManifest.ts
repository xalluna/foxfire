import type { AssetManifest } from '@shared/types'

/**
 * A real Data Dragon manifest, captured from patch 16.16.1 by
 * scripts/../gen (see dev/README) so the browser harness renders genuine
 * champion, spell and rune art.
 *
 * In the app this arrives over IPC because the CSP forbids fetch to the CDN;
 * only images may load from ddragon directly. The harness has no main process
 * to ask, so it ships the manifest inline instead.
 *
 * Generated file — do not hand-edit.
 */
export const DDRAGON_MANIFEST: AssetManifest = {
  "version": "16.16.1",
  "cdn": "https://ddragon.leagueoflegends.com/cdn",
  "championById": {
    "1": {
      "id": "Annie",
      "name": "Annie"
    },
    "2": {
      "id": "Olaf",
      "name": "Olaf"
    },
    "3": {
      "id": "Galio",
      "name": "Galio"
    },
    "4": {
      "id": "TwistedFate",
      "name": "Twisted Fate"
    },
    "5": {
      "id": "XinZhao",
      "name": "Xin Zhao"
    },
    "6": {
      "id": "Urgot",
      "name": "Urgot"
    },
    "7": {
      "id": "Leblanc",
      "name": "LeBlanc"
    },
    "8": {
      "id": "Vladimir",
      "name": "Vladimir"
    },
    "9": {
      "id": "Fiddlesticks",
      "name": "Fiddlesticks"
    },
    "10": {
      "id": "Kayle",
      "name": "Kayle"
    },
    "11": {
      "id": "MasterYi",
      "name": "Master Yi"
    },
    "12": {
      "id": "Alistar",
      "name": "Alistar"
    },
    "13": {
      "id": "Ryze",
      "name": "Ryze"
    },
    "14": {
      "id": "Sion",
      "name": "Sion"
    },
    "15": {
      "id": "Sivir",
      "name": "Sivir"
    },
    "16": {
      "id": "Soraka",
      "name": "Soraka"
    },
    "17": {
      "id": "Teemo",
      "name": "Teemo"
    },
    "18": {
      "id": "Tristana",
      "name": "Tristana"
    },
    "19": {
      "id": "Warwick",
      "name": "Warwick"
    },
    "20": {
      "id": "Nunu",
      "name": "Nunu & Willump"
    },
    "21": {
      "id": "MissFortune",
      "name": "Miss Fortune"
    },
    "22": {
      "id": "Ashe",
      "name": "Ashe"
    },
    "23": {
      "id": "Tryndamere",
      "name": "Tryndamere"
    },
    "24": {
      "id": "Jax",
      "name": "Jax"
    },
    "25": {
      "id": "Morgana",
      "name": "Morgana"
    },
    "26": {
      "id": "Zilean",
      "name": "Zilean"
    },
    "27": {
      "id": "Singed",
      "name": "Singed"
    },
    "28": {
      "id": "Evelynn",
      "name": "Evelynn"
    },
    "29": {
      "id": "Twitch",
      "name": "Twitch"
    },
    "30": {
      "id": "Karthus",
      "name": "Karthus"
    },
    "31": {
      "id": "Chogath",
      "name": "Cho'Gath"
    },
    "32": {
      "id": "Amumu",
      "name": "Amumu"
    },
    "33": {
      "id": "Rammus",
      "name": "Rammus"
    },
    "34": {
      "id": "Anivia",
      "name": "Anivia"
    },
    "35": {
      "id": "Shaco",
      "name": "Shaco"
    },
    "36": {
      "id": "DrMundo",
      "name": "Dr. Mundo"
    },
    "37": {
      "id": "Sona",
      "name": "Sona"
    },
    "38": {
      "id": "Kassadin",
      "name": "Kassadin"
    },
    "39": {
      "id": "Irelia",
      "name": "Irelia"
    },
    "40": {
      "id": "Janna",
      "name": "Janna"
    },
    "41": {
      "id": "Gangplank",
      "name": "Gangplank"
    },
    "42": {
      "id": "Corki",
      "name": "Corki"
    },
    "43": {
      "id": "Karma",
      "name": "Karma"
    },
    "44": {
      "id": "Taric",
      "name": "Taric"
    },
    "45": {
      "id": "Veigar",
      "name": "Veigar"
    },
    "48": {
      "id": "Trundle",
      "name": "Trundle"
    },
    "50": {
      "id": "Swain",
      "name": "Swain"
    },
    "51": {
      "id": "Caitlyn",
      "name": "Caitlyn"
    },
    "53": {
      "id": "Blitzcrank",
      "name": "Blitzcrank"
    },
    "54": {
      "id": "Malphite",
      "name": "Malphite"
    },
    "55": {
      "id": "Katarina",
      "name": "Katarina"
    },
    "56": {
      "id": "Nocturne",
      "name": "Nocturne"
    },
    "57": {
      "id": "Maokai",
      "name": "Maokai"
    },
    "58": {
      "id": "Renekton",
      "name": "Renekton"
    },
    "59": {
      "id": "JarvanIV",
      "name": "Jarvan IV"
    },
    "60": {
      "id": "Elise",
      "name": "Elise"
    },
    "61": {
      "id": "Orianna",
      "name": "Orianna"
    },
    "62": {
      "id": "MonkeyKing",
      "name": "Wukong"
    },
    "63": {
      "id": "Brand",
      "name": "Brand"
    },
    "64": {
      "id": "LeeSin",
      "name": "Lee Sin"
    },
    "67": {
      "id": "Vayne",
      "name": "Vayne"
    },
    "68": {
      "id": "Rumble",
      "name": "Rumble"
    },
    "69": {
      "id": "Cassiopeia",
      "name": "Cassiopeia"
    },
    "72": {
      "id": "Skarner",
      "name": "Skarner"
    },
    "74": {
      "id": "Heimerdinger",
      "name": "Heimerdinger"
    },
    "75": {
      "id": "Nasus",
      "name": "Nasus"
    },
    "76": {
      "id": "Nidalee",
      "name": "Nidalee"
    },
    "77": {
      "id": "Udyr",
      "name": "Udyr"
    },
    "78": {
      "id": "Poppy",
      "name": "Poppy"
    },
    "79": {
      "id": "Gragas",
      "name": "Gragas"
    },
    "80": {
      "id": "Pantheon",
      "name": "Pantheon"
    },
    "81": {
      "id": "Ezreal",
      "name": "Ezreal"
    },
    "82": {
      "id": "Mordekaiser",
      "name": "Mordekaiser"
    },
    "83": {
      "id": "Yorick",
      "name": "Yorick"
    },
    "84": {
      "id": "Akali",
      "name": "Akali"
    },
    "85": {
      "id": "Kennen",
      "name": "Kennen"
    },
    "86": {
      "id": "Garen",
      "name": "Garen"
    },
    "89": {
      "id": "Leona",
      "name": "Leona"
    },
    "90": {
      "id": "Malzahar",
      "name": "Malzahar"
    },
    "91": {
      "id": "Talon",
      "name": "Talon"
    },
    "92": {
      "id": "Riven",
      "name": "Riven"
    },
    "96": {
      "id": "KogMaw",
      "name": "Kog'Maw"
    },
    "98": {
      "id": "Shen",
      "name": "Shen"
    },
    "99": {
      "id": "Lux",
      "name": "Lux"
    },
    "101": {
      "id": "Xerath",
      "name": "Xerath"
    },
    "102": {
      "id": "Shyvana",
      "name": "Shyvana"
    },
    "103": {
      "id": "Ahri",
      "name": "Ahri"
    },
    "104": {
      "id": "Graves",
      "name": "Graves"
    },
    "105": {
      "id": "Fizz",
      "name": "Fizz"
    },
    "106": {
      "id": "Volibear",
      "name": "Volibear"
    },
    "107": {
      "id": "Rengar",
      "name": "Rengar"
    },
    "110": {
      "id": "Varus",
      "name": "Varus"
    },
    "111": {
      "id": "Nautilus",
      "name": "Nautilus"
    },
    "112": {
      "id": "Viktor",
      "name": "Viktor"
    },
    "113": {
      "id": "Sejuani",
      "name": "Sejuani"
    },
    "114": {
      "id": "Fiora",
      "name": "Fiora"
    },
    "115": {
      "id": "Ziggs",
      "name": "Ziggs"
    },
    "117": {
      "id": "Lulu",
      "name": "Lulu"
    },
    "119": {
      "id": "Draven",
      "name": "Draven"
    },
    "120": {
      "id": "Hecarim",
      "name": "Hecarim"
    },
    "121": {
      "id": "Khazix",
      "name": "Kha'Zix"
    },
    "122": {
      "id": "Darius",
      "name": "Darius"
    },
    "126": {
      "id": "Jayce",
      "name": "Jayce"
    },
    "127": {
      "id": "Lissandra",
      "name": "Lissandra"
    },
    "131": {
      "id": "Diana",
      "name": "Diana"
    },
    "133": {
      "id": "Quinn",
      "name": "Quinn"
    },
    "134": {
      "id": "Syndra",
      "name": "Syndra"
    },
    "136": {
      "id": "AurelionSol",
      "name": "Aurelion Sol"
    },
    "141": {
      "id": "Kayn",
      "name": "Kayn"
    },
    "142": {
      "id": "Zoe",
      "name": "Zoe"
    },
    "143": {
      "id": "Zyra",
      "name": "Zyra"
    },
    "145": {
      "id": "Kaisa",
      "name": "Kai'Sa"
    },
    "147": {
      "id": "Seraphine",
      "name": "Seraphine"
    },
    "150": {
      "id": "Gnar",
      "name": "Gnar"
    },
    "154": {
      "id": "Zac",
      "name": "Zac"
    },
    "157": {
      "id": "Yasuo",
      "name": "Yasuo"
    },
    "161": {
      "id": "Velkoz",
      "name": "Vel'Koz"
    },
    "163": {
      "id": "Taliyah",
      "name": "Taliyah"
    },
    "164": {
      "id": "Camille",
      "name": "Camille"
    },
    "166": {
      "id": "Akshan",
      "name": "Akshan"
    },
    "200": {
      "id": "Belveth",
      "name": "Bel'Veth"
    },
    "201": {
      "id": "Braum",
      "name": "Braum"
    },
    "202": {
      "id": "Jhin",
      "name": "Jhin"
    },
    "203": {
      "id": "Kindred",
      "name": "Kindred"
    },
    "221": {
      "id": "Zeri",
      "name": "Zeri"
    },
    "222": {
      "id": "Jinx",
      "name": "Jinx"
    },
    "223": {
      "id": "TahmKench",
      "name": "Tahm Kench"
    },
    "233": {
      "id": "Briar",
      "name": "Briar"
    },
    "234": {
      "id": "Viego",
      "name": "Viego"
    },
    "235": {
      "id": "Senna",
      "name": "Senna"
    },
    "236": {
      "id": "Lucian",
      "name": "Lucian"
    },
    "238": {
      "id": "Zed",
      "name": "Zed"
    },
    "240": {
      "id": "Kled",
      "name": "Kled"
    },
    "245": {
      "id": "Ekko",
      "name": "Ekko"
    },
    "246": {
      "id": "Qiyana",
      "name": "Qiyana"
    },
    "254": {
      "id": "Vi",
      "name": "Vi"
    },
    "266": {
      "id": "Aatrox",
      "name": "Aatrox"
    },
    "267": {
      "id": "Nami",
      "name": "Nami"
    },
    "268": {
      "id": "Azir",
      "name": "Azir"
    },
    "350": {
      "id": "Yuumi",
      "name": "Yuumi"
    },
    "360": {
      "id": "Samira",
      "name": "Samira"
    },
    "412": {
      "id": "Thresh",
      "name": "Thresh"
    },
    "420": {
      "id": "Illaoi",
      "name": "Illaoi"
    },
    "421": {
      "id": "RekSai",
      "name": "Rek'Sai"
    },
    "427": {
      "id": "Ivern",
      "name": "Ivern"
    },
    "429": {
      "id": "Kalista",
      "name": "Kalista"
    },
    "432": {
      "id": "Bard",
      "name": "Bard"
    },
    "497": {
      "id": "Rakan",
      "name": "Rakan"
    },
    "498": {
      "id": "Xayah",
      "name": "Xayah"
    },
    "516": {
      "id": "Ornn",
      "name": "Ornn"
    },
    "517": {
      "id": "Sylas",
      "name": "Sylas"
    },
    "518": {
      "id": "Neeko",
      "name": "Neeko"
    },
    "523": {
      "id": "Aphelios",
      "name": "Aphelios"
    },
    "526": {
      "id": "Rell",
      "name": "Rell"
    },
    "555": {
      "id": "Pyke",
      "name": "Pyke"
    },
    "711": {
      "id": "Vex",
      "name": "Vex"
    },
    "777": {
      "id": "Yone",
      "name": "Yone"
    },
    "799": {
      "id": "Ambessa",
      "name": "Ambessa"
    },
    "800": {
      "id": "Mel",
      "name": "Mel"
    },
    "804": {
      "id": "Yunara",
      "name": "Yunara"
    },
    "805": {
      "id": "Locke",
      "name": "Locke"
    },
    "875": {
      "id": "Sett",
      "name": "Sett"
    },
    "876": {
      "id": "Lillia",
      "name": "Lillia"
    },
    "887": {
      "id": "Gwen",
      "name": "Gwen"
    },
    "888": {
      "id": "Renata",
      "name": "Renata Glasc"
    },
    "893": {
      "id": "Aurora",
      "name": "Aurora"
    },
    "895": {
      "id": "Nilah",
      "name": "Nilah"
    },
    "897": {
      "id": "KSante",
      "name": "K'Sante"
    },
    "901": {
      "id": "Smolder",
      "name": "Smolder"
    },
    "902": {
      "id": "Milio",
      "name": "Milio"
    },
    "904": {
      "id": "Zaahen",
      "name": "Zaahen"
    },
    "910": {
      "id": "Hwei",
      "name": "Hwei"
    },
    "950": {
      "id": "Naafiri",
      "name": "Naafiri"
    }
  },
  "spellById": {
    "1": {
      "id": "SummonerBoost",
      "name": "Cleanse"
    },
    "3": {
      "id": "SummonerExhaust",
      "name": "Exhaust"
    },
    "4": {
      "id": "SummonerFlash",
      "name": "Flash"
    },
    "6": {
      "id": "SummonerHaste",
      "name": "Ghost"
    },
    "7": {
      "id": "SummonerHeal",
      "name": "Heal"
    },
    "11": {
      "id": "SummonerSmite",
      "name": "Smite"
    },
    "12": {
      "id": "SummonerTeleport",
      "name": "Teleport"
    },
    "13": {
      "id": "SummonerMana",
      "name": "Clarity"
    },
    "14": {
      "id": "SummonerDot",
      "name": "Ignite"
    },
    "21": {
      "id": "SummonerBarrier",
      "name": "Barrier"
    },
    "30": {
      "id": "SummonerPoroRecall",
      "name": "To the King!"
    },
    "31": {
      "id": "SummonerPoroThrow",
      "name": "Poro Toss"
    },
    "32": {
      "id": "SummonerSnowball",
      "name": "Mark"
    },
    "39": {
      "id": "SummonerSnowURFSnowball_Mark",
      "name": "Mark"
    },
    "54": {
      "id": "Summoner_UltBookPlaceholder",
      "name": "Placeholder"
    },
    "55": {
      "id": "Summoner_UltBookSmitePlaceholder",
      "name": "Placeholder and Attack-Smite"
    },
    "71": {
      "id": "SummonerBoost_Jade",
      "name": "Cleanse"
    },
    "73": {
      "id": "SummonerExhaust_Jade",
      "name": "Exhaust"
    },
    "74": {
      "id": "SummonerFlash_Jade",
      "name": "Flash"
    },
    "75": {
      "id": "SummonerClairvoyance_Jade",
      "name": "Clairvoyance"
    },
    "76": {
      "id": "SummonerHaste_Jade",
      "name": "Ghost"
    },
    "77": {
      "id": "SummonerHeal_Jade",
      "name": "Heal"
    },
    "705": {
      "id": "SummonerFortify_Jade",
      "name": "Fortify"
    },
    "709": {
      "id": "SummonerRally_Jade",
      "name": "Rally"
    },
    "711": {
      "id": "SummonerSmite_Jade",
      "name": "Smite"
    },
    "712": {
      "id": "SummonerTeleport_Jade",
      "name": "Teleport"
    },
    "713": {
      "id": "SummonerMana_Jade",
      "name": "Clarity"
    },
    "714": {
      "id": "SummonerDot_Jade",
      "name": "Ignite"
    },
    "716": {
      "id": "SummonerBattleCry_Jade",
      "name": "Surge"
    },
    "720": {
      "id": "SummonerSpell_Promote_Jade",
      "name": "Promote"
    },
    "721": {
      "id": "SummonerBarrier_Jade",
      "name": "Barrier"
    },
    "777": {
      "id": "SummonerRevive_Jade",
      "name": "Revive"
    },
    "2201": {
      "id": "SummonerCherryHold",
      "name": "Flee"
    },
    "2202": {
      "id": "SummonerCherryFlash",
      "name": "Flash"
    }
  },
  "runeById": {
    "8000": {
      "icon": "perk-images/Styles/7201_Precision.png",
      "name": "Precision"
    },
    "8005": {
      "icon": "perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png",
      "name": "Press the Attack"
    },
    "8008": {
      "icon": "perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png",
      "name": "Lethal Tempo"
    },
    "8009": {
      "icon": "perk-images/Styles/Precision/PresenceOfMind/PresenceOfMind.png",
      "name": "Presence of Mind"
    },
    "8010": {
      "icon": "perk-images/Styles/Precision/Conqueror/Conqueror.png",
      "name": "Conqueror"
    },
    "8014": {
      "icon": "perk-images/Styles/Precision/CoupDeGrace/CoupDeGrace.png",
      "name": "Coup de Grace"
    },
    "8017": {
      "icon": "perk-images/Styles/Precision/CutDown/CutDown.png",
      "name": "Cut Down"
    },
    "8021": {
      "icon": "perk-images/Styles/Precision/FleetFootwork/FleetFootwork.png",
      "name": "Fleet Footwork"
    },
    "8100": {
      "icon": "perk-images/Styles/7200_Domination.png",
      "name": "Domination"
    },
    "8105": {
      "icon": "perk-images/Styles/Domination/RelentlessHunter/RelentlessHunter.png",
      "name": "Relentless Hunter"
    },
    "8106": {
      "icon": "perk-images/Styles/Domination/UltimateHunter/UltimateHunter.png",
      "name": "Ultimate Hunter"
    },
    "8112": {
      "icon": "perk-images/Styles/Domination/Electrocute/Electrocute.png",
      "name": "Electrocute"
    },
    "8126": {
      "icon": "perk-images/Styles/Domination/CheapShot/CheapShot.png",
      "name": "Cheap Shot"
    },
    "8128": {
      "icon": "perk-images/Styles/Domination/DarkHarvest/DarkHarvest.png",
      "name": "Dark Harvest"
    },
    "8135": {
      "icon": "perk-images/Styles/Domination/TreasureHunter/TreasureHunter.png",
      "name": "Treasure Hunter"
    },
    "8137": {
      "icon": "perk-images/Styles/Domination/SixthSense/SixthSense.png",
      "name": "Sixth Sense"
    },
    "8139": {
      "icon": "perk-images/Styles/Domination/TasteOfBlood/GreenTerror_TasteOfBlood.png",
      "name": "Taste of Blood"
    },
    "8140": {
      "icon": "perk-images/Styles/Domination/GrislyMementos/GrislyMementos.png",
      "name": "Grisly Mementos"
    },
    "8141": {
      "icon": "perk-images/Styles/Domination/DeepWard/DeepWard.png",
      "name": "Deep Ward"
    },
    "8143": {
      "icon": "perk-images/Styles/Domination/SuddenImpact/SuddenImpact.png",
      "name": "Sudden Impact"
    },
    "8200": {
      "icon": "perk-images/Styles/7202_Sorcery.png",
      "name": "Sorcery"
    },
    "8210": {
      "icon": "perk-images/Styles/Sorcery/Transcendence/Transcendence.png",
      "name": "Transcendence"
    },
    "8214": {
      "icon": "perk-images/Styles/Sorcery/SummonAery/SummonAery.png",
      "name": "Summon Aery"
    },
    "8224": {
      "icon": "perk-images/Styles/Sorcery/NullifyingOrb/Axiom_Arcanist.png",
      "name": "Axiom Arcanist"
    },
    "8226": {
      "icon": "perk-images/Styles/Sorcery/ManaflowBand/ManaflowBand.png",
      "name": "Manaflow Band"
    },
    "8229": {
      "icon": "perk-images/Styles/Sorcery/ArcaneComet/ArcaneComet.png",
      "name": "Arcane Comet"
    },
    "8230": {
      "icon": "perk-images/Styles/Sorcery/PhaseRush/StormraidersSurgeRuneIcon2.png",
      "name": "Stormraider's Surge"
    },
    "8232": {
      "icon": "perk-images/Styles/Sorcery/Waterwalking/Waterwalking.png",
      "name": "Waterwalking"
    },
    "8233": {
      "icon": "perk-images/Styles/Sorcery/AbsoluteFocus/AbsoluteFocus.png",
      "name": "Absolute Focus"
    },
    "8234": {
      "icon": "perk-images/Styles/Sorcery/Celerity/CelerityTemp.png",
      "name": "Celerity"
    },
    "8236": {
      "icon": "perk-images/Styles/Sorcery/GatheringStorm/GatheringStorm.png",
      "name": "Gathering Storm"
    },
    "8237": {
      "icon": "perk-images/Styles/Sorcery/Scorch/Scorch.png",
      "name": "Scorch"
    },
    "8242": {
      "icon": "perk-images/Styles/Sorcery/Unflinching/Unflinching.png",
      "name": "Unflinching"
    },
    "8275": {
      "icon": "perk-images/Styles/Sorcery/NimbusCloak/6361.png",
      "name": "Nimbus Cloak"
    },
    "8299": {
      "icon": "perk-images/Styles/Sorcery/LastStand/LastStand.png",
      "name": "Last Stand"
    },
    "8300": {
      "icon": "perk-images/Styles/7203_Whimsy.png",
      "name": "Inspiration"
    },
    "8304": {
      "icon": "perk-images/Styles/Inspiration/MagicalFootwear/MagicalFootwear.png",
      "name": "Magical Footwear"
    },
    "8306": {
      "icon": "perk-images/Styles/Inspiration/HextechFlashtraption/HextechFlashtraption.png",
      "name": "Hextech Flashtraption"
    },
    "8313": {
      "icon": "perk-images/Styles/Inspiration/PerfectTiming/AlchemistCabinet.png",
      "name": "Triple Tonic"
    },
    "8316": {
      "icon": "perk-images/Styles/Inspiration/JackOfAllTrades/JackofAllTrades2.png",
      "name": "Jack Of All Trades"
    },
    "8321": {
      "icon": "perk-images/Styles/Inspiration/CashBack/CashBack2.png",
      "name": "Cash Back"
    },
    "8345": {
      "icon": "perk-images/Styles/Inspiration/BiscuitDelivery/BiscuitDelivery.png",
      "name": "Biscuit Delivery"
    },
    "8347": {
      "icon": "perk-images/Styles/Inspiration/CosmicInsight/CosmicInsight.png",
      "name": "Cosmic Insight"
    },
    "8351": {
      "icon": "perk-images/Styles/Inspiration/GlacialAugment/GlacialAugment.png",
      "name": "Glacial Augment"
    },
    "8352": {
      "icon": "perk-images/Styles/Inspiration/TimeWarpTonic/TimeWarpTonic.png",
      "name": "Time Warp Tonic"
    },
    "8360": {
      "icon": "perk-images/Styles/Inspiration/UnsealedSpellbook/UnsealedSpellbook.png",
      "name": "Unsealed Spellbook"
    },
    "8369": {
      "icon": "perk-images/Styles/Inspiration/FirstStrike/FirstStrike.png",
      "name": "First Strike"
    },
    "8400": {
      "icon": "perk-images/Styles/7204_Resolve.png",
      "name": "Resolve"
    },
    "8401": {
      "icon": "perk-images/Styles/Resolve/MirrorShell/MirrorShell.png",
      "name": "Shield Bash"
    },
    "8410": {
      "icon": "perk-images/Styles/Resolve/ApproachVelocity/ApproachVelocity.png",
      "name": "Approach Velocity"
    },
    "8429": {
      "icon": "perk-images/Styles/Resolve/Conditioning/Conditioning.png",
      "name": "Conditioning"
    },
    "8437": {
      "icon": "perk-images/Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png",
      "name": "Grasp of the Undying"
    },
    "8439": {
      "icon": "perk-images/Styles/Resolve/VeteranAftershock/VeteranAftershock.png",
      "name": "Aftershock"
    },
    "8444": {
      "icon": "perk-images/Styles/Resolve/SecondWind/SecondWind.png",
      "name": "Second Wind"
    },
    "8446": {
      "icon": "perk-images/Styles/Resolve/Demolish/Demolish.png",
      "name": "Demolish"
    },
    "8451": {
      "icon": "perk-images/Styles/Resolve/Overgrowth/Overgrowth.png",
      "name": "Overgrowth"
    },
    "8453": {
      "icon": "perk-images/Styles/Resolve/Revitalize/Revitalize.png",
      "name": "Revitalize"
    },
    "8463": {
      "icon": "perk-images/Styles/Resolve/FontOfLife/FontOfLife.png",
      "name": "Font of Life"
    },
    "8465": {
      "icon": "perk-images/Styles/Resolve/Guardian/Guardian.png",
      "name": "Guardian"
    },
    "8473": {
      "icon": "perk-images/Styles/Resolve/BonePlating/BonePlating.png",
      "name": "Bone Plating"
    },
    "8992": {
      "icon": "perk-images/Styles/Sorcery/DeathfireTouch/DEATHFIRE_TOUCH_KEYSTONE.png",
      "name": "Deathfire Touch"
    },
    "9101": {
      "icon": "perk-images/Styles/Precision/AbsorbLife/AbsorbLife.png",
      "name": "Absorb Life"
    },
    "9103": {
      "icon": "perk-images/Styles/Precision/LegendBloodline/LegendBloodline.png",
      "name": "Legend: Bloodline"
    },
    "9104": {
      "icon": "perk-images/Styles/Precision/LegendAlacrity/LegendAlacrity.png",
      "name": "Legend: Alacrity"
    },
    "9105": {
      "icon": "perk-images/Styles/Precision/LegendHaste/LegendHaste.png",
      "name": "Legend: Haste"
    },
    "9111": {
      "icon": "perk-images/Styles/Precision/Triumph.png",
      "name": "Triumph"
    },
    "9923": {
      "icon": "perk-images/Styles/Domination/HailOfBlades/HailOfBlades.png",
      "name": "Hail of Blades"
    }
  }
}
