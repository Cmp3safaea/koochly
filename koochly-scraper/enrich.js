const axios = require("axios");
const fs = require("fs");

const API_KEY = "AIzaSyCCl0UyEKkDmyCDjatmfctiu0NTBj2XSD8";

// 📂 Load your file
const data = JSON.parse(fs.readFileSync("output_new_2.json", "utf-8"));

// 🔍 Get extra details
async function getDetails(placeId) {
  try {
    const res = await axios.get(
      "https://maps.googleapis.com/maps/api/place/details/json",
      {
        params: {
          place_id: placeId,
          fields: "formatted_phone_number,website,opening_hours,user_ratings_total",
          key: API_KEY
        }
      }
    );

    return res.data.result;
  } catch (err) {
    console.error("❌ Error fetching details:", err.message);
    return null;
  }
}

// 🚀 MAIN
async function run() {
  let count = 0;

  for (let item of data) {
    if (!item.google_place_id) continue;

    console.log(`🔎 Enriching: ${item.title}`);

    const details = await getDetails(item.google_place_id);

    if (details) {
      // 📞 Phone
      item.phone = details.formatted_phone_number || null;

      // 🌐 Website
      item.website = details.website || null;

      // 🕒 Opening hours
      item.opening_hours = details.opening_hours?.weekday_text || [];

      // ⭐ Total reviews
      item.total_reviews = details.user_ratings_total || null;
    }

    count++;

    // ⏳ Delay (VERY IMPORTANT to avoid rate limits)
    await new Promise(r => setTimeout(r, 200));
  }

  // 💾 Save updated file
  fs.writeFileSync("output_enriched_new_2.json", JSON.stringify(data, null, 2));

  console.log(`\n✅ Enriched ${count} businesses`);
  console.log("📁 Saved to output_enriched_new_2.json");
}

run();