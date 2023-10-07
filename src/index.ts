import axios from "axios";
import dotenv from "dotenv";
import { db } from "./firebase";
import { CronJob } from "cron";
import express from "express";
import twilio from "twilio";

dotenv.config();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

type Fire = {
  latitude: number;
  longitude: number;
  bright_ti4: number;
  scan: number;
  track: number;
  confidence: number;
  bright_ti5: number;
  frp: number;
  country_id: string;
  acq_date: string;
  acq_time: string;
  satellite: string;
  instrument: string;
  version: string;
  daynight: string;
};

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
    const collectionRef = db.collection("fires");
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

type InterestPoint = {
  label: string;
  lat: number;
  lng: number;
  radius: number;
  userId: string;
};

async function NotifyUsers(userFires: {
  [userId: string]: { point: InterestPoint; fires: Fire[] }[];
}) {
  const userIds = Object.keys(userFires);
  // Get from collection "phones" the phone number of each user (the userdId is the same id of the document)
  const phonesRef = db.collection("phones");
  const phones: { [userId: string]: string } = {};
  for (const userId of userIds) {
    const doc = await phonesRef.doc(userId).get();
    if (doc.exists) {
      phones[userId] = doc.data()?.phone;

      // Send a message to each user
      const fires = userFires[userId];
      let message = "Incendio cerca de " + fires[0].point.label + "\n";

      try {
        client.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phones[userId],
        });
      } catch (e) {
        console.error(e);
      }
    }
  }

  // Send a message to each user
}

async function analyzeFires(fires: Fire[]) {
  try {
    // Get collection InterestPoints
    const interestPointsRef = db.collection("interestPoints");
    const querySnapshot = await interestPointsRef.get();
    const interestPoints: InterestPoint[] = [];
    querySnapshot.forEach((doc) => {
      interestPoints.push(doc.data() as InterestPoint);
    });

    const notificationToUser: {
      [key: string]: { point: InterestPoint; fires: Fire[] }[];
    } = {};

    // For each interest point
    interestPoints.forEach((interestPoint) => {
      // Get fires in radius
      const firesInRadius = fires.filter((fire) => {
        const distance =
          Math.acos(
            Math.sin(fire.latitude) * Math.sin(interestPoint.lat) +
              Math.cos(fire.latitude) *
                Math.cos(interestPoint.lat) *
                Math.cos(fire.longitude - interestPoint.lng)
          ) * 6371;
        return distance <= interestPoint.radius;
      });

      if (firesInRadius.length > 0) {
        if (!notificationToUser[interestPoint.userId]) {
          notificationToUser[interestPoint.userId] = [];
        }
        notificationToUser[interestPoint.userId].push({
          point: interestPoint,
          fires: firesInRadius,
        });
      }
    });

    // Send notification to users
    await NotifyUsers(notificationToUser);
  } catch (e) {
    console.error(e);
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
    try {
      await analyzeFires(data);
    } catch (e) {
      console.error(e);
    }
  } catch (e) {
    console.error(e);
    await SaveFires();
  }
}

// Every 30 minutes
SaveFires();
const job = new CronJob("*/30 * * * *", SaveFires, null, true);

const app = express();
