

const API_KEY = "AIzaSyCCl0UyEKkDmyCDjatmfctiu0NTBj2XSD8";
const axios = require("axios");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

// 🌍 GLOBAL CITIES (expand anytime)
const cities = [

  { fa: "منچستر", en: "Manchester" },
  { fa: "بیرمنگام", en: "Birmingham" },
  { fa: "لیدز", en: "Leeds" },
  { fa: "گلاسگو", en: "Glasgow" },
  { fa: "لیورپول", en: "Liverpool" },
  { fa: "بریستول", en: "Bristol" },
  { fa: "ادینبرو", en: "Edinburgh" },
  { fa: "ناتینگهام", en: "Nottingham" },
  { fa: "شفیلد", en: "Sheffield" },
  { fa: "لستر", en: "Leicester" },
  { fa: "کاونتری", en: "Coventry" },
  { fa: "بردفورد", en: "Bradford" },
  { fa: "کاردیف", en: "Cardiff" },
  { fa: "بلفاست", en: "Belfast" },
];

// 🧩 Categories
const categories = [
  { fa: "رستوران‌ها", en: "restaurant", code: "restaurants" },
  { fa: "سوپرمارکت‌ها", en: "grocery", code: "grocery" },
  { fa: "دندان‌پزشکان", en: "dentist", code: "dentists" },
  { fa: "وکلای حقوقی", en: "lawyer", code: "lawyers" },
  { fa: "حسابداران رسمی", en: "accountant", code: "accountants" },
  { fa: "آرایشگاه‌ها", en: "hair salon", code: "beauty" },
  { fa: "املاک", en: "real estate", code: "real_estate" }
];

// 🔍 Search prefixes
const prefixes = [
  "iranian",
  "persian",
  "farsi",
];

// 🖼️ Image builder
function getImages(place) {
  if (!place.photos) return [];

  return place.photos.slice(0, 2).map(p =>
    `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${p.photo_reference}&key=${API_KEY}`
  );
}

// 🔄 Fetch with pagination
async function fetchPlaces(query) {
  let results = [];
  let nextPageToken = null;

  do {
    const res = await axios.get(
      "https://maps.googleapis.com/maps/api/place/textsearch/json",
      {
        params: {
          query,
          key: API_KEY,
          pagetoken: nextPageToken
        }
      }
    );

    results.push(...res.data.results);

    nextPageToken = res.data.next_page_token;

    if (nextPageToken) {
      await new Promise(r => setTimeout(r, 2000));
    }

  } while (nextPageToken);

  return results;
}

// 🧱 Map to your schema
function map(place, city, category) {
  return {
    id: uuidv4(),

    title: place.name,
    address: place.formatted_address,

    location: {
      __lat__: place.geometry.location.lat,
      __lon__: place.geometry.location.lng
    },

    GoogleRate: place.rating || null,
    google_place_id: place.place_id,

    images: getImages(place),

    cat: category.fa,
    cat_code: category.code,

    city: city.fa,
    city_eng: city.en,

    approved: true,
    details: "Imported from Google"
  };
}

// 🚀 MAIN
async function run() {
  let all = [];
  let seen = new Set();

  for (const city of cities) {
    console.log(`\n🌍 CITY: ${city.en}`);

    for (const category of categories) {
      for (const prefix of prefixes) {

        const query = `${prefix} ${category.en} in ${city.en}`;
        console.log("🔎", query);

        try {
          const places = await fetchPlaces(query);

          for (const p of places) {
            if (seen.has(p.place_id)) continue;

            seen.add(p.place_id);

            const item = map(p, city, category);
            all.push(item);
          }

        } catch (err) {
          console.error("❌ Error:", err.message);
        }
      }
    }
  }

  console.log(`\n✅ TOTAL BUSINESSES: ${all.length}`);

  fs.writeFileSync("output_new.json", JSON.stringify(all, null, 2));
  console.log("📁 Saved to output_new.json");
}

run();