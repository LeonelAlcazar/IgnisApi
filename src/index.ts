import axios from "axios";
import dotenv from "dotenv";
import { db } from "./firebase";
import { CronJob } from "cron";

dotenv.config();

function parseCSV<T>(csv: string): T[] {
  const lines = csv.split("\n");
  const result: T[] = [];
  const headers = lines[0].split(",");

  for (let i = 1; i < lines.length; i++) {
    const obj: any = {};
    const currentline = lines[i].split(",");

    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = currentline[j];
    }

    result.push(obj);
  }

  //return result; //JavaScript object
  return result; //JSON
}

async function GetVIIRSData() {
  const response = await axios.get(
    "https://firms.modaps.eosdis.nasa.gov/api/country/csv/" +
      process.env.MAP_KEY +
      "/VIIRS_SNPP_NRT/ARG/1/" +
      new Date().toISOString().slice(0, 10)
  );
  const raw = parseCSV<{
    country_id: string;
    latitude: string;
    longitude: string;
    bright_ti4: string;
    scan: string;
    track: string;
    acq_date: string;
    acq_time: string;
    satellite: string;
    instrument: string;
    confidence: string;
    version: string;
    bright_ti5: string;
    frp: string;
    daynight: string;
  }>(response.data);

  return raw.map((item) => ({
    ...item,
    latitude: parseFloat(item.latitude),
    longitude: parseFloat(item.longitude),
    bright_ti4: parseFloat(item.bright_ti4),
    scan: parseFloat(item.scan),
    track: parseFloat(item.track),
    confidence: parseFloat(item.confidence),
    bright_ti5: parseFloat(item.bright_ti5),
    frp: parseFloat(item.frp),
  }));
}

async function deleteCollection() {
  try {
    const collectionRef = db.collection("firese");
    const querySnapshot = await collectionRef.get();

    // Delete each document in the collection
    querySnapshot.forEach((doc) => {
      doc.ref.delete();
    });

    console.log(`All documents in collection ${"fires"} deleted successfully.`);
  } catch (error) {
    console.error("Error deleting documents:", error);
  }
}

async function SaveFires() {
  try {
    console.log("Give me the fires!");
    const data = await GetVIIRSData();
    await deleteCollection();
    const writeBatch = db.batch();

    data.forEach((item) => {
      const docRef = db.collection("fires").doc();
      writeBatch.set(docRef, {
        lat: item.latitude,
        lng: item.longitude,
        date: new Date(item.acq_date),
        temp: item.bright_ti4,
      });
    });

    await writeBatch.commit();
    console.log("Fires saved!");
  } catch (e) {
    console.error(e);
    await SaveFires();
  }
}

// Every 30 minutes
SaveFires();
const job = new CronJob("*/30 * * * *", SaveFires, null, true);
