import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
const serviceAccount = require("../../ignis-service-account.json");

const firebaseApp = initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://ignis-5f3c9.firebaseio.com",
});

export const db = getFirestore(firebaseApp);
