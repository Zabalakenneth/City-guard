// Firebase SDK
import { initializeApp } from "firebase/app"
import { getAuth } from "firebase/auth"
import { getFirestore } from "firebase/firestore"

// Firebase configuration (from your friend's project)
const firebaseConfig = {
  apiKey: "AIzaSyDoVwmGTA4u6t9L5vdv6LUnbJJ4rQEfs5A",
  authDomain: "cityguard-53367.firebaseapp.com",
  projectId: "cityguard-53367",
  storageBucket: "cityguard-53367.firebasestorage.app",
  messagingSenderId: "1026728958360",
  appId: "1:1026728958360:web:02aa389838151d18f5b3ed",
  measurementId: "G-SJSTXEQ4D9"
}

// Initialize Firebase
const app = initializeApp(firebaseConfig)

// Firebase Authentication (login system)
export const auth = getAuth(app)

// Firestore Database (reports, users, etc)
export const db = getFirestore(app)

export default app