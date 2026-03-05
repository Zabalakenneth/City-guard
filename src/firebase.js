// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyD9kkGZ6YgpabI40iGIzc7PjGctIVsd9VQ",
  authDomain: "city-guard-3fc12.firebaseapp.com",
  projectId: "city-guard-3fc12",
  storageBucket: "city-guard-3fc12.firebasestorage.app",
  messagingSenderId: "189829038990",
  appId: "1:189829038990:web:c794ea93e036fe56ef1adf",
  measurementId: "G-ZJSW77R7HS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// AUTH (for login / forgot password)
export const auth = getAuth(app);

// DATABASE (optional but useful later)
export const db = getFirestore(app);